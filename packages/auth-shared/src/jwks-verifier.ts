import { createRemoteJWKSet, jwtVerify, type JWTVerifyResult } from "jose";
import { AuthTokenClaimsSchema, type AuthTokenClaims } from "@betterbasket/contracts";

export interface JwksVerifierOptions {
  issuer: string;
  audience: string;
  jwksUrl: string;
  cacheMaxAgeMs?: number;
  cooldownMs?: number;
}

/** Verifies user JWTs with a cached, private auth-service key set. */
export class JwksVerifier {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly options: JwksVerifierOptions) {
    if (!options.issuer || !options.audience)
      throw new Error("JWT issuer and audience are required");
    this.jwks = createRemoteJWKSet(new URL(options.jwksUrl), {
      cacheMaxAge: options.cacheMaxAgeMs,
      cooldownDuration: options.cooldownMs,
    });
  }

  async verify(token: string): Promise<AuthTokenClaims> {
    const { payload }: JWTVerifyResult = await jwtVerify(token, this.jwks, {
      issuer: this.options.issuer,
      audience: this.options.audience,
      algorithms: ["EdDSA"],
      clockTolerance: 5,
    });
    return AuthTokenClaimsSchema.parse(payload);
  }
}

let processVerifier: JwksVerifier | undefined;

export function createJwksVerifierFromEnv(): JwksVerifier {
  if (processVerifier) return processVerifier;
  const issuer = process.env.AUTH_ISSUER;
  const jwksUrl = process.env.AUTH_JWKS_URL;
  if (!issuer || !jwksUrl) throw new Error("AUTH_ISSUER and AUTH_JWKS_URL are required");
  processVerifier = new JwksVerifier({
    issuer,
    audience: process.env.AUTH_AUDIENCE || issuer,
    jwksUrl,
  });
  return processVerifier;
}
