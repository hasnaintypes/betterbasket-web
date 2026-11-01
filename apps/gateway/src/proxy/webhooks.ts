import type { INestApplication } from "@nestjs/common";
import { acceptedRequestId, getRequestId, getRequestLogger } from "@betterbasket/runtime";
import type { Request, Response } from "express";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { randomUUID } from "node:crypto";
import type { GatewayConfig } from "../config";
import { securityHeaders } from "../cors";

const maxBodyBytes = 1024 * 1024;
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

function envelope(
  req: Request,
  res: Response,
  status: number,
  code: string,
  message: string,
): void {
  if (res.writableEnded) return;
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const requestId =
    getRequestId() ?? acceptedRequestId(req.headers["x-request-id"]) ?? randomUUID();
  res.setHeader("X-Request-Id", requestId);
  res.status(status).json({ error: { code, message, requestId, details: [] } });
}

function stripHeaders(
  headers: Record<string, unknown>,
  connection: string | string[] | undefined,
): void {
  const nominated = typeof connection === "string" ? connection.split(",") : [];
  for (const name of [...hopHeaders, ...nominated]) delete headers[name.trim().toLowerCase()];
}

/** Streams webhook bytes unchanged; payment-service validates Stripe signatures. */
export function registerWebhooks(app: INestApplication, config: GatewayConfig): void {
  const target = new URL(config.PAYMENT_SERVICE_URL);
  const send = target.protocol === "https:" ? httpsRequest : httpRequest;
  app.use("/webhooks/stripe", (req: Request, res: Response) => {
    const publicPath = req.originalUrl.split("?", 1)[0];
    if (publicPath !== "/webhooks/stripe/account" && publicPath !== "/webhooks/stripe/connect") {
      envelope(req, res, 404, "NOT_FOUND", "Not found");
      return;
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      envelope(req, res, 405, "METHOD_NOT_ALLOWED", "Method not allowed");
      return;
    }
    const contentLength = req.headers["content-length"];
    if (contentLength !== undefined && Number(contentLength) > maxBodyBytes) {
      envelope(req, res, 413, "PAYLOAD_TOO_LARGE", "Request body too large");
      req.resume();
      return;
    }
    const requestId =
      getRequestId() ?? acceptedRequestId(req.headers["x-request-id"]) ?? randomUUID();
    res.setHeader("X-Request-Id", requestId);
    const headers = { ...req.headers } as Record<string, string | string[] | undefined>;
    stripHeaders(headers, req.headers.connection);
    delete headers.authorization;
    delete headers.cookie;
    for (const name of Object.keys(headers))
      if (name.startsWith("x-internal-")) delete headers[name];
    delete headers["content-length"];
    headers.host = target.host;
    headers["x-request-id"] = requestId;
    let limitExceeded = false;
    let timedOut = false;
    let bodyBytes = 0;
    const upstream = send(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        method: "POST",
        path: `${target.pathname.replace(/\/$/, "")}/payments/webhook/${publicPath.endsWith("/account") ? "account" : "connect"}${req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : ""}`,
        headers,
      },
      (upstreamRes) => {
        upstreamRes.on("error", (err) => {
          getRequestLogger()?.error({ err, route: publicPath }, "webhook upstream response failed");
          envelope(req, res, 502, "UPSTREAM_UNAVAILABLE", "Upstream service unavailable");
        });
        if (res.headersSent) {
          upstreamRes.destroy();
          return;
        }
        const responseHeaders = { ...upstreamRes.headers } as Record<string, unknown>;
        stripHeaders(responseHeaders, upstreamRes.headers.connection);
        for (const [name, value] of Object.entries(responseHeaders))
          if (value !== undefined && name !== "x-request-id")
            res.setHeader(name, value as string | string[]);
        for (const [name, value] of Object.entries(securityHeaders)) res.setHeader(name, value);
        res.setHeader("X-Request-Id", requestId);
        res.statusCode = upstreamRes.statusCode ?? 502;
        upstreamRes.pipe(res);
      },
    );
    upstream.setTimeout(8000, () => {
      timedOut = true;
      upstream.destroy();
    });
    req.setTimeout(10000, () => {
      timedOut = true;
      upstream.destroy();
      envelope(req, res, 504, "TIMEOUT", "Request timed out");
    });
    upstream.on("error", (err) => {
      if (limitExceeded || res.writableEnded) return;
      getRequestLogger()?.error({ err, route: publicPath }, "webhook proxy failed");
      envelope(
        req,
        res,
        timedOut ? 504 : 502,
        timedOut ? "TIMEOUT" : "UPSTREAM_UNAVAILABLE",
        timedOut ? "Upstream request timed out" : "Upstream service unavailable",
      );
    });
    req.on("data", (chunk: Buffer) => {
      if (limitExceeded) return;
      bodyBytes += chunk.length;
      if (bodyBytes > maxBodyBytes) {
        limitExceeded = true;
        upstream.destroy();
        envelope(req, res, 413, "PAYLOAD_TOO_LARGE", "Request body too large");
        return;
      }
      if (!upstream.write(chunk)) req.pause();
    });
    upstream.on("drain", () => req.resume());
    req.on("end", () => {
      if (!limitExceeded) upstream.end();
    });
    req.on("aborted", () => upstream.destroy());
    req.on("error", () => upstream.destroy());
  });
}
