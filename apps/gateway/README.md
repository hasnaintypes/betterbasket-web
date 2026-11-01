# Gateway HTTP routes

The gateway sends HTTP requests to private services using the validated `*_SERVICE_URL` values. It does not authenticate clients; each service checks its own requests.

| Public prefix    | Upstream prefix | Target config           |
| ---------------- | --------------- | ----------------------- |
| `/api/auth`      | `/api/auth`     | `AUTH_SERVICE_URL`      |
| `/api/products`  | `/products`     | `PRODUCT_SERVICE_URL`   |
| `/api/sellers`   | `/sellers`      | `SELLER_SERVICE_URL`    |
| `/api/orders`    | `/orders`       | `ORDER_SERVICE_URL`     |
| `/api/payments`  | `/payments`     | `PAYMENT_SERVICE_URL`   |
| `/api/media`     | `/media`        | `MEDIA_SERVICE_URL`     |
| `/api/analytics` | `/analytics`    | `ANALYTICS_SERVICE_URL` |

The suffix and query string are preserved. The gateway propagates a valid UUID `X-Request-Id` or generates one, strips hop-by-hop headers, rejects unsafe paths, and limits upstream calls to 8 seconds. Connection failures return a 502 `UPSTREAM_UNAVAILABLE` envelope; timeouts return a 504 `TIMEOUT` envelope. There is no HTTP route for notification-service.

## Browser access and webhooks

Set `CORS_ALLOWED_ORIGINS` to a comma-separated list of frontend origins. The gateway allows credentials and the `GET, POST, PUT, PATCH, DELETE, OPTIONS` methods, with `Authorization`, `Content-Type`, `Idempotency-Key`, and `X-Request-Id` request headers. Preflight responses are cached for 10 minutes. Other origins receive no CORS headers.

Only `POST /webhooks/stripe/account` and `POST /webhooks/stripe/connect` reach payment-service at `/payments/webhook/account` and `/payments/webhook/connect`. The gateway streams the request body unchanged, forwards `Stripe-Signature` and `Content-Type`, removes authorization, cookies, and internal headers, and rejects bodies over 1 MB. Payment-service verifies the signature. Other methods return 405.

Gateway responses include `X-Content-Type-Options`, `Strict-Transport-Security`, and `Referrer-Policy`; auth routes also use `Cache-Control: no-store`.

## Real-time dashboards

Socket.IO clients connect through `/realtime` using WebSocket transport only. The gateway rewrites the Engine.IO upgrade URL to analytics-service's `/socket.io` path and preserves the `/realtime` namespace. Browser origins must be listed in `CORS_ALLOWED_ORIGINS`; an absent or unlisted `Origin` is refused. HTTP long polling is unavailable.

```ts
io("https://api.example/realtime", { path: "/realtime", transports: ["websocket"] });
```

The gateway leaves established WebSocket connections open without an HTTP proxy timeout. Clients should use Socket.IO heartbeat and reconnection behavior; deployment idle timeouts must exceed the negotiated ping interval plus ping timeout. Authentication and room assignment are enforced by analytics-service when implemented. HTTP requests under `/internal/*` and `/api/auth/jwks` return 404 at the gateway.
