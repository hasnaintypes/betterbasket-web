import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { after, test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import authShared from "@betterbasket/auth-shared";

const { JwksVerifier, JwtAuthGuard, JwtVerificationError, createJwksVerifierFromEnv } = authShared;
const servers = [];
after(async () => {
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
});

async function issuer() {
  let keys = [];
  let requests = 0;
  let available = true;
  const server = createServer((request, response) => {
    requests++;
    if (request.url !== "/jwks" || !available) {
      response.writeHead(503).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ keys: keys.map(({ jwk }) => jwk) }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  servers.push(server);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const addKey = async () => {
    const pair = await generateKeyPair("EdDSA", { extractable: true });
    const kid = randomUUID();
    const jwk = { ...(await exportJWK(pair.publicKey)), kid, alg: "EdDSA", use: "sig" };
    keys.push({ jwk, privateKey: pair.privateKey });
    return kid;
  };
  await addKey();
  return {
    origin,
    jwksUrl: `${origin}/jwks`,
    get requests() {
      return requests;
    },
    set available(value) {
      available = value;
    },
    addKey,
    removeFirstKey() {
      keys = keys.slice(1);
    },
    sign({ key = keys.at(-1), audience = origin, issuer = origin, exp = "15m" } = {}) {
      return new SignJWT({
        sub: "user-1",
        email: "user@example.test",
        emailVerified: true,
        platformRole: "customer",
        orgId: null,
        orgRole: null,
      })
        .setProtectedHeader({ alg: "EdDSA", kid: key.jwk.kid })
        .setIssuer(issuer)
        .setAudience(audience)
        .setIssuedAt()
        .setExpirationTime(exp)
        .setJti(randomUUID())
        .sign(key.privateKey);
    },
  };
}

async function rejectsWith(verifier, token, code = "UNAUTHENTICATED") {
  await assert.rejects(verifier.verify(token), (error) => {
    assert.ok(error instanceof JwtVerificationError);
    assert.equal(error.code, code);
    assert.ok(!error.message.includes(token));
    return true;
  });
}

test("verifier pins EdDSA, issuer, audience, signature, and expiry", async () => {
  const source = await issuer();
  const verifier = new JwksVerifier({
    issuer: source.origin,
    audience: source.origin,
    jwksUrl: source.jwksUrl,
  });
  const valid = await source.sign();
  assert.equal((await verifier.verify(valid)).sub, "user-1");
  await rejectsWith(verifier, await source.sign({ audience: "https://other.example" }));
  await rejectsWith(verifier, await source.sign({ issuer: "https://other.example" }));
  assert.equal((await verifier.verify(await source.sign({ exp: "-2s" }))).sub, "user-1");
  await rejectsWith(verifier, await source.sign({ exp: "-1m" }), "TOKEN_EXPIRED");

  const [header, payload, signature] = valid.split(".");
  const changedPayload = Buffer.from(
    JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url")), sub: "other" }),
  ).toString("base64url");
  await rejectsWith(verifier, `${header}.${changedPayload}.${signature}`);
  const hsHeader = Buffer.from(JSON.stringify({ alg: "HS256", kid: "known" })).toString(
    "base64url",
  );
  const hsData = `${hsHeader}.${payload}`;
  await rejectsWith(
    verifier,
    `${hsData}.${createHmac("sha256", "known").update(hsData).digest("base64url")}`,
  );
  const noneHeader = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  await rejectsWith(verifier, `${noneHeader}.${payload}.`);
});

test("guard maps an expired JWT to the safe TOKEN_EXPIRED response code", async () => {
  const source = await issuer();
  const verifier = new JwksVerifier({
    issuer: source.origin,
    audience: source.origin,
    jwksUrl: source.jwksUrl,
  });
  const request = { headers: { authorization: `Bearer ${await source.sign({ exp: "-1m" })}` } };
  const context = { switchToHttp: () => ({ getRequest: () => request }) };
  await assert.rejects(new JwtAuthGuard(verifier).canActivate(context), (error) => {
    assert.equal(error.status, 401);
    assert.equal(error.getResponse().code, "TOKEN_EXPIRED");
    return true;
  });
});

test("unknown kid refetches once, and an unavailable JWKS fails closed", async () => {
  const source = await issuer();
  const verifier = new JwksVerifier({
    issuer: source.origin,
    audience: source.origin,
    jwksUrl: source.jwksUrl,
    cooldownMs: 0,
  });
  source.available = false;
  await rejectsWith(verifier, await source.sign());
  source.available = true;
  await verifier.verify(await source.sign());
  const before = source.requests;
  await source.addKey();
  assert.equal((await verifier.verify(await source.sign())).sub, "user-1");
  assert.equal(source.requests, before + 1);

  source.removeFirstKey();
  source.available = false;
  await source.addKey();
  await rejectsWith(verifier, await source.sign());
});

test("env factory requires explicit settings and returns one verifier", () => {
  const previous = [process.env.AUTH_ISSUER, process.env.AUTH_AUDIENCE, process.env.AUTH_JWKS_URL];
  try {
    delete process.env.AUTH_ISSUER;
    delete process.env.AUTH_JWKS_URL;
    assert.throws(() => createJwksVerifierFromEnv(), /AUTH_ISSUER and AUTH_JWKS_URL/);
    process.env.AUTH_ISSUER = "https://api.example.test";
    process.env.AUTH_JWKS_URL = "https://auth.internal.example.test/jwks";
    const first = createJwksVerifierFromEnv();
    assert.equal(createJwksVerifierFromEnv(), first);
  } finally {
    for (const [index, name] of ["AUTH_ISSUER", "AUTH_AUDIENCE", "AUTH_JWKS_URL"].entries()) {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    }
  }
});
