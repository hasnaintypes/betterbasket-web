import type { INestApplication } from "@nestjs/common";
import { createProxyMiddleware } from "http-proxy-middleware";
import { randomUUID } from "node:crypto";
import { getRequestId, getRequestLogger } from "@betterbasket/runtime";
import { ServiceRegistry } from "./service-registry";

/**
 * Path-prefix based routing to downstream services, e.g.
 *   /api/products/**  -> product-service
 *   /api/orders/**    -> order-service
 *
 * The gateway does NOT decode/verify JWTs on the client's behalf — it just
 * routes + rate-limits + logs. Every downstream service independently
 * verifies the bearer token via JWKS (see @betterbasket/auth-shared). This
 * keeps the gateway a thin, replaceable layer instead of a second source of
 * truth for auth.
 */
export function registerProxies(app: INestApplication, registry: ServiceRegistry): void {
  const routes: Array<[prefix: string, target: string, ws?: boolean]> = [
    ["/api/auth", registry.auth],
    ["/api/products", registry.product],
    ["/api/sellers", registry.seller],
    ["/api/orders", registry.order],
    ["/api/payments", registry.payment],
    ["/api/notifications", registry.notification],
    ["/api/media", registry.media],
    ["/api/analytics", registry.analytics, true],
  ];

  for (const [prefix, target, ws] of routes) {
    app.use(
      prefix,
      createProxyMiddleware({
        target,
        changeOrigin: true,
        ws: ws ?? false,
        on: {
          error: (err, _req, res) => {
            getRequestLogger()?.error({ err, prefix }, "proxy request failed");
            if ("writeHead" in res && !res.headersSent) {
              const requestId = getRequestId() ?? randomUUID();
              res.writeHead(502, { "Content-Type": "application/json", "X-Request-Id": requestId });
              res.end(
                JSON.stringify({
                  error: {
                    code: "UPSTREAM_UNAVAILABLE",
                    message: "Upstream service unavailable",
                    requestId,
                    details: [],
                  },
                }),
              );
            }
          },
        },
      }),
    );
  }
}
