import {
  applyDecorators,
  Injectable,
  Optional,
  type CanActivate,
  type ExecutionContext,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { InternalTokenVerifier } from "./internal-token.js";

@Injectable()
export class InternalAuthGuard implements CanActivate {
  private readonly verifier: InternalTokenVerifier;

  constructor(@Optional() verifier?: InternalTokenVerifier) {
    const service = process.env.SERVICE_NAME;
    if (!verifier && !service) throw new Error("SERVICE_NAME is required for InternalAuthGuard");
    this.verifier = verifier ?? new InternalTokenVerifier(service!);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const path = String(request.path ?? request.url ?? "").split("?")[0] ?? "";
    const header: unknown = request.headers?.authorization;
    if (!/^\/internal\//.test(path) || typeof header !== "string" || !/^Bearer [^ ]+$/.test(header))
      throw new UnauthorizedException("Invalid internal request");
    try {
      request.service = this.verifier.verify((header as string).slice(7));
      return true;
    } catch {
      throw new UnauthorizedException("Invalid internal token");
    }
  }
}

/** Protect only routes under /internal/*. */
export function Internal() {
  return applyDecorators(UseGuards(InternalAuthGuard));
}
