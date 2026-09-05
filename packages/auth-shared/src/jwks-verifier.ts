import { createRemoteJWKSet, jwtVerify, type JWTVerifyResult } from "jose";
import { AuthTokenClaimsSchema, type AuthTokenClaims } from "@betterbasket/contracts";

/**
 * Every non-auth service verifies Better Auth JWTs locally against the
 * auth-service's JWKS endpoint (`${AUTH_SERVICE_URL}/api/auth/jwks`) — no
 * network call to auth-service on every request, just a cached public key set.
 */
export class JwksVerifier {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    private readonly issuer: string,
    jwksUrl: string,
    private readonly audience: string = issuer,
  ) {
    this.jwks = createRemoteJWKSet(new URL(jwksUrl));
  }

  async verify(token: string): Promise<AuthTokenClaims> {
    const { payload }: JWTVerifyResult = await jwtVerify(token, this.jwks, {
      issuer: this.issuer,
      audience: this.audience,
    });
    return AuthTokenClaimsSchema.parse(payload);
  }
}

export function createJwksVerifierFromEnv(): JwksVerifier {
  const authServiceUrl = process.env.AUTH_SERVICE_URL ?? "http://localhost:4001";
  return new JwksVerifier(authServiceUrl, `${authServiceUrl}/api/auth/jwks`);
}
