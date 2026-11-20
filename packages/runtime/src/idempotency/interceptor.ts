import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  BadRequestException,
  HttpException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { from, lastValueFrom, type Observable } from "rxjs";
import { z } from "zod";
import { toErrorEnvelope } from "../http/all-exceptions.filter";
import { getRequestId } from "../http/request-id.middleware";
import { IdempotencyKeyReusedError, IdempotencyStore, RequestInProgressError } from "./store";

const IDEMPOTENT_ROUTE = Symbol("idempotent-route");
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface IdempotentRequest extends IncomingMessage {
  body?: unknown;
  user?: { sub?: string };
  route?: { path?: string };
  baseUrl?: string;
  path?: string;
}

/** Mark a route for the globally registered IdempotencyInterceptor. */
export const Idempotent = () => SetMetadata(IDEMPOTENT_ROUTE, true);

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function requestBodyHash(body: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(body ?? null)))
    .digest("hex");
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly store: IdempotencyStore,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const enabled = this.reflector.getAllAndOverride<boolean>(IDEMPOTENT_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!enabled) return next.handle();
    return from(this.run(context, next));
  }

  private async run(context: ExecutionContext, next: CallHandler): Promise<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<IdempotentRequest>();
    const response = http.getResponse<ServerResponse>();
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string" || key.length > 255 || !uuidPattern.test(key)) {
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: "A UUID Idempotency-Key is required",
      });
    }
    const userId = request.user?.sub;
    if (typeof userId !== "string" || !userId) throw new UnauthorizedException();
    const route = `${request.baseUrl ?? ""}${request.path ?? request.route?.path ?? request.url?.split("?")[0] ?? ""}`;
    const scope = JSON.stringify([userId, request.method, route]);
    const requestHash = requestBodyHash(request.body);
    const requestId = getRequestId() ?? randomUUID();

    try {
      const result = await this.store.execute(scope, key, requestHash, async () => {
        try {
          const body = await lastValueFrom(next.handle(), { defaultValue: undefined });
          return { status: response.statusCode, body, requestId };
        } catch (error) {
          if (
            error instanceof z.ZodError ||
            (error instanceof HttpException && error.getStatus() < 500)
          ) {
            return { ...toErrorEnvelope(error, requestId), requestId };
          }
          throw error;
        }
      });
      response.statusCode = result.status;
      response.setHeader("X-Request-Id", result.requestId ?? requestId);
      return result.body;
    } catch (error) {
      if (error instanceof IdempotencyKeyReusedError) {
        throw new HttpException({ code: "IDEMPOTENCY_KEY_REUSED" }, 422);
      }
      if (error instanceof RequestInProgressError) {
        throw new HttpException({ code: "REQUEST_IN_PROGRESS" }, 409);
      }
      throw error;
    }
  }
}
