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
