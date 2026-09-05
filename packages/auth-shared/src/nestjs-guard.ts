import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  SetMetadata,
  UseGuards,
  applyDecorators,
} from "@nestjs/common";
import type { PlatformRole } from "@betterbasket/contracts";
import { JwksVerifier, createJwksVerifierFromEnv } from "./jwks-verifier.js";

const ROLES_KEY = "betterbasket:roles";

/** Restricts a controller/handler to one or more platform roles (customer/seller/admin). */
export const Roles = (...roles: PlatformRole[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Verifies the `Authorization: Bearer <jwt>` header against auth-service's
 * JWKS and attaches `request.user` (AuthTokenClaims). Use on every protected
 * route in every downstream service (product, seller, order, payment, ...).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly verifier: JwksVerifier;

  constructor(verifier?: JwksVerifier) {
    this.verifier = verifier ?? createJwksVerifierFromEnv();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const header: string | undefined = request.headers?.authorization;

    if (!header?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing bearer token");
    }

    try {
      request.user = await this.verifier.verify(header.slice("Bearer ".length));
      return true;
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }
  }
}

/** Pairs with `@Roles(...)`. Register both as global/controller-level guards. */
@Injectable()
export class RolesGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const required: PlatformRole[] =
      Reflect.getMetadata(ROLES_KEY, context.getHandler()) ??
      Reflect.getMetadata(ROLES_KEY, context.getClass()) ??
      [];

    if (required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user || !required.includes(user.role)) {
      throw new ForbiddenException(`Requires one of roles: ${required.join(", ")}`);
    }
    return true;
  }
}

/** Convenience: `@Auth("seller", "admin")` = JwtAuthGuard + RolesGuard + @Roles(...) in one decorator. */
export function Auth(...roles: PlatformRole[]) {
  return applyDecorators(UseGuards(JwtAuthGuard, RolesGuard), Roles(...roles));
}
