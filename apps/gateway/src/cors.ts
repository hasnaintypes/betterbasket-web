import type { INestApplication } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import type { GatewayConfig } from "./config";

export const securityHeaders = {
  "x-content-type-options": "nosniff",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "referrer-policy": "no-referrer",
} as const;

export function registerSecurityHeaders(app: INestApplication): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    for (const [name, value] of Object.entries(securityHeaders)) res.setHeader(name, value);
    const path = req.originalUrl.split("?", 1)[0];
    if (path === "/api/auth" || path?.startsWith("/api/auth/"))
      res.setHeader("Cache-Control", "no-store");
    next();
  });
}

export function configureCors(app: INestApplication, config: GatewayConfig): void {
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, result?: string | boolean) => void,
    ) =>
      callback(
        null,
        origin !== undefined && config.CORS_ALLOWED_ORIGINS.includes(origin) ? origin : false,
      ),
    credentials: true,
    methods: "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    allowedHeaders: "Authorization,Content-Type,Idempotency-Key,X-Request-Id",
    exposedHeaders: "X-Request-Id,RateLimit-*,Retry-After",
    maxAge: 600,
  });
}
