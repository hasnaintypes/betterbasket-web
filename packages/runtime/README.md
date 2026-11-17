# Runtime configuration

Define an app's environment schema with Zod, using the `url()`, `secret()`, `csv()`, `bool()`, and `port()` helpers from `@betterbasket/runtime`. After the app loads its environment file, call `loadConfig(schema)`. It returns a frozen, typed object. Invalid or missing values stop startup with exit code 1 and print variable names only, never values.

Keep each app's `.env.development.example` and `.env.production.example` keys in sync with its schema. The gateway shows the pattern. Tests may call `loadConfig(schema, testEnv)` with an explicit source; production code uses `process.env`.

## Nest HTTP wiring

Register a Pino logger with the `REQUEST_LOGGER` token, apply `RequestIdMiddleware` to all routes, and register `AllExceptionsFilter` as an `APP_FILTER`. The middleware accepts a valid UUID request header or generates one, echoes `X-Request-Id`, and binds a child logger to the request with `AsyncLocalStorage`. `getRequestLogger()` and `getRequestId()` read that context in downstream code.

```ts
@Module({
  providers: [
    { provide: REQUEST_LOGGER, useValue: createLogger({ service: "my-service" }) },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes("*");
  }
}
```

Use `new ZodValidationPipe(schema)` on request bodies and parameters. It returns parsed data or a 400 `VALIDATION_FAILED` envelope with JSON-pointer-like field paths. The filter converts Nest HTTP exceptions, direct Zod errors, and unknown errors into `{ error: { code, message, requestId, details } }`. Unknown server failures are logged with full detail and return a safe generic message.

## Service bootstrap

`bootstrapService({ module, name, port, options })` creates a Nest app with CORS disabled, Pino logging, request IDs, the error filter, graceful shutdown hooks, and a listener on `0.0.0.0`. It returns the running app. Pass a port callback when the port becomes available only after the module loads its environment file. `beforeInit` can mount raw body handlers or proxy routes before Nest registers its 404 handler. `bodyParser: false` and `rawBody: true` pass through to Nest.

The helper serves `GET /health` with `status`, `service`, `timestamp`, and `version` from `GIT_SHA` (or `unknown`). `GET /ready` is 200 with no checks registered. Register checks with `getReadinessRegistry(app).register(name, check)`; a failed or thrown check returns 503. Readiness also returns 503 during shutdown. SIGTERM starts graceful shutdown so in-flight requests can finish.

Swagger is served when `NODE_ENV` is not `production`, or when `ENABLE_DOCS=true`. In production it is otherwise absent. Apps that need browser access must explicitly enable CORS with their own validated origin list.

## Idempotent mutations

Postgres services can include `idempotencyKeysTable` in their Drizzle schema and
apply a service-owned migration before enabling idempotent routes. Register
`IDEMPOTENCY_POOL` with a dedicated Postgres pool, then register
`IdempotencyStore`, `IdempotencyCleanup`, and `IdempotencyInterceptor` as
providers. Register the interceptor globally with `APP_INTERCEPTOR`; it only
acts on methods marked `@Idempotent()`.

```ts
@Module({
  providers: [
    { provide: IDEMPOTENCY_POOL, useValue: idempotencyPool },
    IdempotencyStore,
    IdempotencyCleanup,
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class AppModule {}

@Post("orders")
@Idempotent()
createOrder() { /* handler */ }
```

Apply the authentication guard before the interceptor: the scope uses the
authenticated `user.sub`, HTTP method, and concrete route path. The header must be
a UUID `Idempotency-Key`; absent or malformed keys return 400. The body is
hashed as canonical JSON, so object key order has no effect. The first call
stores its status and body for 24 hours. Repeating the same key and body
replays the stored response and original request ID; a different body returns
422 `IDEMPOTENCY_KEY_REUSED`. A concurrent call returns 409
`REQUEST_IN_PROGRESS`. A 4xx handler result is stored; a 5xx or thrown server
error is not. A pending claim can be retried after a 30-second lease if the
first process crashes. A row lock prevents a second handler from running while
the first still owns the claim. The cleanup provider removes expired rows
hourly; the store also reclaims an expired key on its next use.

Use a separate pool for idempotency because the row lock holds one connection
while the handler runs. Any external side effect in the handler must use a
deterministic provider idempotency key derived from an internal ID. Add the
interceptor to mutation endpoints only when those endpoint issues are
implemented.
