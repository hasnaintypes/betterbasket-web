import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import type { AuthTokenClaims } from "@betterbasket/contracts";

// Native Node resolution keeps jose's ESM entry point usable inside Jest's
// CommonJS runtime on the repository's Node 22 baseline.
const { exportJWK, generateKeyPair, SignJWT } = createRequire(__filename)(
  "jose",
) as typeof import("jose");

export async function createJwtTestIssuer() {
  const { publicKey, privateKey } = await generateKeyPair("EdDSA", { extractable: true });
  const kid = randomUUID();
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: "EdDSA", use: "sig" };
  const server = createServer((request, response) => {
    if (request.url !== "/api/auth/jwks") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ keys: [jwk] }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("JWKS server has no TCP address");
  const issuer = `http://127.0.0.1:${address.port}`;
  return {
    issuer,
    audience: issuer,
    jwksUrl: `${issuer}/api/auth/jwks`,
    async sign(claims: Partial<Omit<AuthTokenClaims, "iss" | "aud" | "iat" | "exp">> = {}) {
      return new SignJWT({
        sub: claims.sub ?? "test-user-1",
        email: claims.email ?? "user@example.test",
        role: claims.role ?? "customer",
        ...(claims.activeOrganizationId
          ? { activeOrganizationId: claims.activeOrganizationId }
          : {}),
      })
        .setProtectedHeader({ alg: "EdDSA", kid })
        .setIssuer(issuer)
        .setAudience(issuer)
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(privateKey);
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
