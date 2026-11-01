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

WebSocket upgrades and Stripe webhooks are separate planned gateway work.
