import type { INestApplication } from "@nestjs/common";
import { acceptedRequestId, getRequestId } from "@betterbasket/runtime";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

function isBlocked(rawUrl: string): boolean {
  let path = rawUrl.split("?", 1)[0] ?? "";
  for (let i = 0; i < 3; i++) {
    try {
      const next = decodeURIComponent(path);
      if (next === path) break;
      path = next;
    } catch {
      break;
    }
  }
  return /^\/internal(?:\/|$)/i.test(path) || /^\/api\/auth\/jwks(?:\/|$)/i.test(path);
}

export function registerBlockedPaths(app: INestApplication): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!isBlocked(req.originalUrl)) return next();
    const requestId =
      getRequestId() ?? acceptedRequestId(req.headers["x-request-id"]) ?? randomUUID();
    res.setHeader("X-Request-Id", requestId);
    res
      .status(404)
      .json({ error: { code: "NOT_FOUND", message: "Not found", requestId, details: [] } });
  });
}
