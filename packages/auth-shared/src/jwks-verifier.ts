import { createRemoteJWKSet, jwtVerify, errors } from "jose";
import { AuthTokenClaimsSchema, type AuthTokenClaims } from "@betterbasket/contracts";

export interface JwksVerifierOptions {
  issuer: string;
  audience: string;
  jwksUrl: string;
  cacheMaxAgeMs?: number;
  cooldownMs?: number;
}

export class JwtVerificationError extends Error {
  constructor(readonly code: "TOKEN_EXPIRED" | "UNAUTHENTICATED") {
    super(code === "TOKEN_EXPIRED" ? "Token expired" : "Authentication required");
    this.name = "JwtVerificationError";
  }
}

// Share remote key sets across guards. jose owns the cache, cooldown, and
// unknown-kid refetch; the token cannot select a JWKS endpoint.
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export class JwksVerifier {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly options: JwksVerifierOptions) {
    if (!options.issuer || !options.audience || !options.jwksUrl) {
      throw new Error("Issuer, audience and JWKS URL are required");
    }
    const jwksUrl = new URL(options.jwksUrl);
    if (!["http:", "https:"].includes(jwksUrl.protocol)) {
      throw new Error("JWKS URL must use HTTP or HTTPS");
    }
    const key = JSON.stringify([
      jwksUrl.href,
      options.cacheMaxAgeMs ?? null,
      options.cooldownMs ?? null,
    ]);
    let jwks = keySets.get(key);
    if (!jwks) {
      jwks = createRemoteJWKSet(jwksUrl, {
        cacheMaxAge: options.cacheMaxAgeMs,
        cooldownDuration: options.cooldownMs,
      });
      keySets.set(key, jwks);
    }
    this.jwks = jwks;
  }

  async verify(token: string): Promise<AuthTokenClaims> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.options.issuer,
        audience: this.options.audience,
        algorithms: ["EdDSA"],
        clockTolerance: 5,
      });
      return AuthTokenClaimsSchema.parse(payload);
    } catch (error) {
      throw new JwtVerificationError(
        error instanceof errors.JWTExpired ? "TOKEN_EXPIRED" : "UNAUTHENTICATED",
      );
    }
  }
}

let envVerifier: JwksVerifier | undefined;
export function createJwksVerifierFromEnv(): JwksVerifier {
  if (envVerifier) return envVerifier;
  const issuer = process.env.AUTH_ISSUER;
  const jwksUrl = process.env.AUTH_JWKS_URL;
  if (!issuer || !jwksUrl) {
    throw new Error("AUTH_ISSUER and AUTH_JWKS_URL are required");
  }
  envVerifier = new JwksVerifier({
    issuer,
    audience: process.env.AUTH_AUDIENCE || issuer,
    jwksUrl,
  });
  return envVerifier;
}
