import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Inject,
  type ExceptionFilter,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import { z } from "zod";
import type { Logger } from "@betterbasket/logger";
import { REQUEST_LOGGER, getRequestId, getRequestLogger } from "./request-id.middleware";
import { zodDetails, type ValidationDetail } from "./zod-validation.pipe";

const statusDefaults: Record<number, { code: string; message: string }> = {
  400: { code: "MALFORMED_REQUEST", message: "Invalid request" },
  401: { code: "UNAUTHENTICATED", message: "Authentication required" },
  403: { code: "FORBIDDEN", message: "Access denied" },
  404: { code: "NOT_FOUND", message: "Not found" },
  409: { code: "CONFLICT", message: "Request conflict" },
  422: { code: "UNPROCESSABLE_ENTITY", message: "Unprocessable request" },
  429: { code: "RATE_LIMITED", message: "Too many requests" },
  502: { code: "UPSTREAM_UNAVAILABLE", message: "Upstream unavailable" },
  503: { code: "UPSTREAM_UNAVAILABLE", message: "Service unavailable" },
  504: { code: "TIMEOUT", message: "Request timed out" },
};

const allowedCodes = new Set([
  "VALIDATION_FAILED",
  "MALFORMED_REQUEST",
  "UNAUTHENTICATED",
  "TOKEN_EXPIRED",
  "FORBIDDEN",
  "SELLER_NOT_ACTIVE",
  "EMAIL_NOT_VERIFIED",
  "NOT_FOUND",
  "INSUFFICIENT_STOCK",
  "INVALID_TRANSITION",
  "REQUEST_IN_PROGRESS",
  "PRICE_CHANGED",
  "IDEMPOTENCY_KEY_REUSED",
  "RATE_LIMITED",
  "UPSTREAM_UNAVAILABLE",
  "TIMEOUT",
]);

function httpResponse(exception: HttpException): {
  status: number;
  code: string;
  message: string;
  details: ValidationDetail[];
} {
  const status = exception.getStatus();
  if (status >= 500 && status !== 502 && status !== 503 && status !== 504) {
    return { status, code: "INTERNAL_ERROR", message: "Internal server error", details: [] };
  }
  const fallback = statusDefaults[status] ?? { code: "HTTP_ERROR", message: "Request failed" };
  const response = exception.getResponse();
  const body =
    typeof response === "object" && response !== null && !Array.isArray(response)
      ? (response as Record<string, unknown>)
      : {};
  const code =
    typeof body.code === "string" && allowedCodes.has(body.code) ? body.code : fallback.code;
  const details =
    code === "VALIDATION_FAILED" && Array.isArray(body.details)
      ? body.details.filter(
          (item): item is ValidationDetail =>
            typeof item === "object" &&
            item !== null &&
            typeof item.field === "string" &&
            typeof item.issue === "string" &&
            (item.issue === "Invalid type" || item.issue === "Invalid value"),
        )
      : [];
  return {
    status,
    code,
    message: code === "VALIDATION_FAILED" ? "Validation failed" : fallback.message,
    details,
  };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(@Inject(REQUEST_LOGGER) private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<ServerResponse>();
    const requestId = getRequestId() ?? randomUUID();
    const logger = getRequestLogger() ?? this.logger.child({ requestId });
    logger.error({ err: exception }, "request failed");
    if (response.headersSent) {
      if (!response.writableEnded) response.end();
      return;
    }
    const result =
      exception instanceof z.ZodError
        ? {
            status: HttpStatus.BAD_REQUEST,
            code: "VALIDATION_FAILED",
            message: "Validation failed",
            details: zodDetails(exception),
          }
        : exception instanceof HttpException
          ? httpResponse(exception)
          : {
              status: HttpStatus.INTERNAL_SERVER_ERROR,
              code: "INTERNAL_ERROR",
              message: "Internal server error",
              details: [],
            };
    response.setHeader("X-Request-Id", requestId);
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.statusCode = result.status;
    response.end(
      JSON.stringify({
        error: { code: result.code, message: result.message, requestId, details: result.details },
      }),
    );
  }
}
