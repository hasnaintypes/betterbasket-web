import {
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import type { AuthTokenClaims, Capability as CapabilityName } from "@betterbasket/contracts";
import { errors } from "jose";
import { JwksVerifier, createJwksVerifierFromEnv } from "./jwks-verifier.js";

export const PUBLIC_KEY = "betterbasket:public";
export const CAPABILITY_KEY = "betterbasket:capability";
export const HIGH_RISK_KEY = "betterbasket:high-risk";
export const INTERNAL_KEY = "betterbasket:internal";

export const Public = () => SetMetadata(PUBLIC_KEY, true);
export const Capability = (capability: CapabilityName) => SetMetadata(CAPABILITY_KEY, capability);
export const HighRisk = () => SetMetadata(HIGH_RISK_KEY, true);

export interface TenantContext {
  sellerId: string;
}

export interface AuthenticatedRequest {
  user: AuthTokenClaims;
  tenant?: TenantContext;
}

export interface SellerAccessProvider {
  resolve(
    user: AuthTokenClaims,
    capability: CapabilityName,
    highRisk: boolean,
  ): Promise<TenantContext | null>;
}

export class DenyingSellerAccessProvider implements SellerAccessProvider {
  async resolve(): Promise<null> {
    return null;
  }
}

export interface CapabilityDecision {
  allowed: boolean;
  tenant?: TenantContext;
  reason?: "EMAIL_NOT_VERIFIED";
}

export interface CapabilityResolver {
  resolve(
    user: AuthTokenClaims,
    capability: CapabilityName,
    highRisk: boolean,
  ): Promise<CapabilityDecision>;
}

const buyerCapabilities = new Set<CapabilityName>([
  "order:create",
  "order:read-own",
  "payment:create",
]);

export class DefaultCapabilityResolver implements CapabilityResolver {
  constructor(
    private readonly sellerAccess: SellerAccessProvider = new DenyingSellerAccessProvider(),
  ) {}

  async resolve(
    user: AuthTokenClaims,
    capability: CapabilityName,
    highRisk: boolean,
  ): Promise<CapabilityDecision> {
    if (buyerCapabilities.has(capability)) {
      return user.emailVerified
        ? { allowed: true }
        : { allowed: false, reason: "EMAIL_NOT_VERIFIED" };
    }
    if (capability === "admin:*") return { allowed: user.platformRole === "admin" };
    const tenant = await this.sellerAccess.resolve(user, capability, highRisk);
    return tenant ? { allowed: true, tenant } : { allowed: false };
  }
}

function metadata<T>(context: ExecutionContext, key: string): T | undefined {
  const handler = context.getHandler?.();
  const controller = context.getClass?.();
  return (
    (handler && Reflect.getMetadata(key, handler)) ??
    (controller && Reflect.getMetadata(key, controller))
  );
}

/** Registered before CapabilityGuard for every Nest route. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly verifier?: Pick<JwksVerifier, "verify">) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest & { headers?: { authorization?: string } }>();
    const isPublic = metadata<boolean>(context, PUBLIC_KEY) === true;
    if (metadata<boolean>(context, INTERNAL_KEY) === true) return true;
    const header = request.headers?.authorization;
    if (!header?.startsWith("Bearer ")) {
      if (isPublic) return true;
      throw new UnauthorizedException({ code: "UNAUTHENTICATED" });
    }
    try {
      request.user = await (this.verifier ?? createJwksVerifierFromEnv()).verify(header.slice(7));
      return true;
    } catch (error) {
      if (isPublic) return true;
      if (error instanceof errors.JWTExpired)
        throw new UnauthorizedException({ code: "TOKEN_EXPIRED" });
      throw new UnauthorizedException({ code: "UNAUTHENTICATED" });
    }
  }
}

/** A route without @Public or @Capability is denied even with a valid JWT. */
@Injectable()
export class CapabilityGuard implements CanActivate {
  constructor(private readonly resolver: CapabilityResolver = new DefaultCapabilityResolver()) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (metadata<boolean>(context, INTERNAL_KEY) === true) return true;
    if (metadata<boolean>(context, PUBLIC_KEY) === true) return true;
    const capability = metadata<CapabilityName>(context, CAPABILITY_KEY);
    if (!capability) throw new ForbiddenException({ code: "FORBIDDEN" });
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) throw new UnauthorizedException({ code: "UNAUTHENTICATED" });
    if (buyerCapabilities.has(capability) && !request.user.emailVerified)
      throw new ForbiddenException({ code: "EMAIL_NOT_VERIFIED" });
    if (capability === "admin:*" && request.user.platformRole !== "admin")
      throw new ForbiddenException({ code: "FORBIDDEN" });
    let decision: CapabilityDecision;
    try {
      decision = await this.resolver.resolve(
        request.user,
        capability,
        metadata<boolean>(context, HIGH_RISK_KEY) === true,
      );
    } catch {
      throw new ForbiddenException({ code: "FORBIDDEN" });
    }
    if (!decision.allowed) throw new ForbiddenException({ code: decision.reason ?? "FORBIDDEN" });
    if (!buyerCapabilities.has(capability) && capability !== "admin:*" && !decision.tenant)
      throw new ForbiddenException({ code: "FORBIDDEN" });
    if (decision.tenant) request.tenant = decision.tenant;
    return true;
  }
}
