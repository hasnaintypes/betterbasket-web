import type { INestApplication } from "@nestjs/common";
import { createProxyMiddleware } from "http-proxy-middleware";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { acceptedRequestId, getRequestId, getRequestLogger } from "@betterbasket/runtime";
import type { GatewayConfig } from "../config";
import { securityHeaders } from "../cors";
import { routes } from "./routes";

const hopHeaders = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];
const proxyStartedAt = new WeakMap<IncomingMessage, number>();

function requestId(req: IncomingMessage, res: ServerResponse): string {
  const id = getRequestId() ?? acceptedRequestId(req.headers["x-request-id"]) ?? randomUUID();
  res.setHeader("X-Request-Id", id);
  return id;
}

function errorResponse(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  code: string,
): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const id = requestId(req, res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(
    JSON.stringify({
      error: {
        code,
        message:
          code === "TIMEOUT"
            ? "Upstream request timed out"
            : code === "UPSTREAM_UNAVAILABLE"
              ? "Upstream service unavailable"
              : "Invalid request path",
        requestId: id,
        details: [],
      },
    }),
  );
}

function unsafePath(url: string): boolean {
  const path = url.split("?", 1)[0] ?? "";
  if (path.includes("//") || /%2f|%5c/i.test(path)) return true;
  try {
    let decoded = path;
    for (let i = 0; i < 3; i++) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
      if (decoded.includes("//") || decoded.includes("\\") || decoded.split("/").includes(".."))
        return true;
    }
    return decoded.includes("%");
  } catch {
    return true;
  }
}

function stripHopHeaders(
  headers: Record<string, unknown>,
  connection: string | string[] | undefined,
): void {
  const nominated = typeof connection === "string" ? connection.split(",") : [];
  for (const name of [...hopHeaders, ...nominated]) delete headers[name.trim().toLowerCase()];
}

/** Downstream services perform their own authentication and authorization. */
export function registerProxies(app: INestApplication, config: GatewayConfig): void {
  for (const route of routes) {
    app.use(
      route.prefix,
      (req: IncomingMessage & { originalUrl?: string }, res: ServerResponse, next: () => void) => {
        const url = req.originalUrl ?? req.url ?? "";
        if (url.length > 8192) return errorResponse(req, res, 414, "MALFORMED_REQUEST");
        if (unsafePath(url)) return errorResponse(req, res, 400, "MALFORMED_REQUEST");
        const id = requestId(req, res);
        req.headers["x-request-id"] = id;
        proxyStartedAt.set(req, Date.now());
        next();
      },
    );

    app.use(
      route.prefix,
      createProxyMiddleware({
        target: config[route.target],
        changeOrigin: true,
        ws: false,
        proxyTimeout: 8000,
        pathRewrite: (path) =>
          route.upstreamPrefix + (path === "/" ? "" : path.startsWith("/?") ? path.slice(1) : path),
        on: {
          proxyReq: (proxyReq, req) => {
            const connection = req.headers.connection;
            for (const name of [
              ...hopHeaders,
              ...(typeof connection === "string" ? connection.split(",") : []),
            ])
              proxyReq.removeHeader(name.trim());
            proxyReq.setHeader(
              "X-Request-Id",
              getRequestId() ?? acceptedRequestId(req.headers["x-request-id"]) ?? randomUUID(),
            );
          },
          proxyRes: (proxyRes, req) => {
            proxyStartedAt.delete(req);
            stripHopHeaders(proxyRes.headers, proxyRes.headers.connection);
            Object.assign(proxyRes.headers, securityHeaders);
            if (route.prefix === "/api/auth") proxyRes.headers["cache-control"] = "no-store";
            proxyRes.headers["x-request-id"] =
              getRequestId() ?? acceptedRequestId(req.headers["x-request-id"]) ?? randomUUID();
          },
          error: (err, req, res) => {
            getRequestLogger()?.error({ err, route: route.prefix }, "proxy request failed");
            if ("writeHead" in res) {
              const startedAt = proxyStartedAt.get(req);
              proxyStartedAt.delete(req);
              const timeout =
                "code" in err &&
                (err.code === "ETIMEDOUT" ||
                  err.code === "ESOCKETTIMEDOUT" ||
                  (err.code === "ECONNRESET" &&
                    startedAt !== undefined &&
                    Date.now() - startedAt >= 7900));
              errorResponse(
                req,
                res,
                timeout ? 504 : 502,
                timeout ? "TIMEOUT" : "UPSTREAM_UNAVAILABLE",
              );
            }
          },
        },
      }),
    );
  }
}

/** Upgrade URLs retain their public prefix; analytics uses Socket.IO's /socket.io engine path. */
export function registerWebSocketUpgrades(server: Server, config: GatewayConfig): void {
  const proxy = createProxyMiddleware({
    target: config.ANALYTICS_SERVICE_URL,
    changeOrigin: true,
    ws: true,
    pathRewrite: (path) => path.replace(/^\/realtime(?=\/|\?|$)/, "/socket.io"),
    on: {
      proxyReqWs: (proxyReq, req) => {
        proxyReq.setHeader(
          "X-Request-Id",
          acceptedRequestId(req.headers["x-request-id"]) ?? randomUUID(),
        );
      },
      error: (err, _req, res) => {
        getRequestLogger()?.error({ err, route: "/realtime" }, "websocket proxy failed");
        res.destroy();
      },
    },
  });
  server.on("upgrade", (req, socket, head) => {
    const path = (req.url ?? "").split("?", 1)[0];
    if (
      (path !== "/realtime" && path !== "/realtime/") ||
      typeof req.headers.origin !== "string" ||
      !config.CORS_ALLOWED_ORIGINS.includes(req.headers.origin)
    ) {
      socket.destroy();
      return;
    }
    proxy.upgrade(req, socket as Socket, head);
  });
}
