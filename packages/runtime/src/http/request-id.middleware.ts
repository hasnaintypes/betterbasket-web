import { Inject, Injectable, type NestMiddleware } from "@nestjs/common";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Logger } from "@betterbasket/logger";

export const REQUEST_LOGGER = "REQUEST_LOGGER";

interface RequestContext {
  requestId: string;
  logger: Logger;
}

const requestContext = new AsyncLocalStorage<RequestContext>();
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}

export function getRequestLogger(): Logger | undefined {
  return requestContext.getStore()?.logger;
}

export function acceptedRequestId(header: string | string[] | undefined): string | undefined {
  if (typeof header !== "string" || header.length > 64 || !uuidPattern.test(header))
    return undefined;
  return header;
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  constructor(@Inject(REQUEST_LOGGER) private readonly logger: Logger) {}

  use(req: IncomingMessage, res: ServerResponse, next: (error?: Error) => void): void {
    const requestId = acceptedRequestId(req.headers["x-request-id"]) ?? randomUUID();
    res.setHeader("X-Request-Id", requestId);
    requestContext.run({ requestId, logger: this.logger.child({ requestId }) }, next);
  }
}
