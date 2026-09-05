import type { INestApplication } from "@nestjs/common";
import { createProxyMiddleware } from "http-proxy-middleware";
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
export function registerProxies(app: INestApplication): void {
  const routes: Array<[prefix: string, target: string, ws?: boolean]> = [
    ["/api/auth", ServiceRegistry.auth],
    ["/api/products", ServiceRegistry.product],
    ["/api/sellers", ServiceRegistry.seller],
    ["/api/orders", ServiceRegistry.order],
    ["/api/payments", ServiceRegistry.payment],
    ["/api/notifications", ServiceRegistry.notification],
    ["/api/media", ServiceRegistry.media],
    ["/api/analytics", ServiceRegistry.analytics, true],
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
            console.error(`[gateway] proxy error for ${prefix} -> ${target}:`, err.message);
            if ("writeHead" in res) {
              res.writeHead(502, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ message: "Upstream service unavailable" }));
            }
          },
        },
      }),
    );
  }
}
