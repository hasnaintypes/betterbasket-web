import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { createRequire } from "node:module";
import authShared from "@betterbasket/auth-shared";

const { exportJWK, generateKeyPair, SignJWT } = createRequire(import.meta.url)("jose");
const { JwksVerifier, JwtAuthGuard, createJwksVerifierFromEnv } = authShared;

test("verifier requires explicit configuration", () => {
  assert.throws(() => new JwksVerifier({ issuer: "", audience: "x", jwksUrl: "http://x" }));
  assert.throws(() => new JwksVerifier({ issuer: "x", audience: "", jwksUrl: "http://x" }));
  const previousIssuer = process.env.AUTH_ISSUER;
  const previousUrl = process.env.AUTH_JWKS_URL;
  try {
    delete process.env.AUTH_ISSUER;
    delete process.env.AUTH_JWKS_URL;
    assert.throws(() => createJwksVerifierFromEnv(), /AUTH_ISSUER and AUTH_JWKS_URL/);
  } finally {
    if (previousIssuer === undefined) delete process.env.AUTH_ISSUER;
    else process.env.AUTH_ISSUER = previousIssuer;
    if (previousUrl === undefined) delete process.env.AUTH_JWKS_URL;
    else process.env.AUTH_JWKS_URL = previousUrl;
  }
});

test("verifier pins EdDSA, issuer and audience and refreshes an unknown key", async () => {
  const keys = [];
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ keys: keys.map(({ jwk }) => jwk) }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const issuer = `http://127.0.0.1:${server.address().port}`;
  const makeKey = async () => {
    const pair = await generateKeyPair("EdDSA", { extractable: true });
    const kid = randomUUID();
    const jwk = { ...(await exportJWK(pair.publicKey)), kid, alg: "EdDSA", use: "sig" };
    const key = { ...pair, kid, jwk };
    keys.push(key);
    return key;
  };
  const sign = (key, overrides = {}) => {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      sub: "user-1",
      email: "user@example.test",
      emailVerified: true,
      platformRole: "customer",
      orgId: null,
      orgRole: null,
    })
      .setProtectedHeader({ alg: "EdDSA", kid: key.kid })
      .setIssuer(overrides.issuer ?? issuer)
      .setAudience(overrides.audience ?? issuer)
      .setIssuedAt(now)
      .setExpirationTime(overrides.exp ?? now + 60)
      .setJti(randomUUID())
      .sign(key.privateKey);
  };
  try {
    const first = await makeKey();
    const verifier = new JwksVerifier({
      issuer,
      audience: issuer,
      jwksUrl: `${issuer}/jwks`,
      cooldownMs: 0,
    });
    assert.equal((await verifier.verify(await sign(first))).sub, "user-1");
    assert.equal(requests, 1);
    await assert.rejects(verifier.verify(await sign(first, { issuer: "https://other.example" })));
    await assert.rejects(verifier.verify(await sign(first, { audience: "https://other.example" })));
    const expired = await sign(first, { exp: Math.floor(Date.now() / 1000) - 10 });
    await assert.rejects(verifier.verify(expired));
    const guard = new JwtAuthGuard(verifier);
    const contextFor = (token) => ({
      switchToHttp: () => ({
        getRequest: () => ({ headers: { authorization: `Bearer ${token}` } }),
      }),
    });
    await assert.rejects(
      guard.canActivate(contextFor(expired)),
      (error) => error.getStatus() === 401 && error.getResponse().code === "TOKEN_EXPIRED",
    );
    const valid = await sign(first);
    const [header, payload, signature] = valid.split(".");
    await assert.rejects(verifier.verify(`${header}.${payload}.${signature.slice(1)}x`));
    const unknownHeader = Buffer.from(JSON.stringify({ alg: "EdDSA", kid: "unknown" })).toString(
      "base64url",
    );
    await assert.rejects(verifier.verify(`${unknownHeader}.${payload}.${signature}`));
    const second = await makeKey();
    assert.equal((await verifier.verify(await sign(second))).sub, "user-1");
    assert.ok(requests >= 2);
    const hsHeader = Buffer.from(JSON.stringify({ alg: "HS256", kid: first.kid })).toString(
      "base64url",
    );
    const hsBody = `${hsHeader}.${payload}`;
    const hsSignature = createHmac("sha256", "known-secret").update(hsBody).digest("base64url");
    await assert.rejects(verifier.verify(`${hsBody}.${hsSignature}`));
    await assert.rejects(
      guard.canActivate(contextFor(`${hsBody}.${hsSignature}`)),
      (error) => error.getStatus() === 401 && error.getResponse().code === "UNAUTHENTICATED",
    );
    const noneHeader = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    await assert.rejects(verifier.verify(`${noneHeader}.${payload}.`));
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
