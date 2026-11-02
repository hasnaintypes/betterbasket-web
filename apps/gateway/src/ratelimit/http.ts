import type { INestApplication } from "@nestjs/common";
import { acceptedRequestId, getRequestId } from "@betterbasket/runtime";
import { randomUUID } from "node:crypto";
import type { Express, NextFunction, Request, Response } from "express";
import type { GatewayConfig } from "../config";
import { trustedClientIp } from "./client-ip";
import { RateLimiter, rateLimitHeaders } from "./limiter";
import { resolveRateLimitClass } from "./policy";

export function registerRateLimiting(
  app: INestApplication,
  config: GatewayConfig,
  limiter: RateLimiter,
): void {
  const expressApp = app.getHttpAdapter().getInstance() as Express;
  expressApp.set("trust proxy", config.TRUSTED_PROXY_HOPS);
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === "OPTIONS") return next();
    const ip = trustedClientIp(
      req.socket.remoteAddress,
      req.headers["x-forwarded-for"],
      config.TRUSTED_PROXY_HOPS,
    );
    void limiter
      .check(resolveRateLimitClass(req.method, req.originalUrl), ip)
      .then((decision) => {
        if (!decision) return next();
        for (const [name, value] of Object.entries(rateLimitHeaders(decision)))
          res.setHeader(name, value);
        if (decision.allowed) return next();
        const requestId =
          getRequestId() ?? acceptedRequestId(req.headers["x-request-id"]) ?? randomUUID();
        res.setHeader("X-Request-Id", requestId);
        res.setHeader("Retry-After", String(decision.resetSeconds));
        res.status(429).json({
          error: {
            code: "RATE_LIMITED",
            message: "Too many requests",
            requestId,
            details: [],
          },
        });
      })
      .catch(next);
  });
}
