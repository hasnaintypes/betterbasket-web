import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { Controller, Get, Module, UseGuards } from "@nestjs/common";
import authShared from "@betterbasket/auth-shared";
import testUtils from "../dist/index.js";

const {
  InternalTokenSigner,
  InternalTokenVerifier,
  InternalAuthGuard,
  Internal,
  InternalHttpClient,
  JwtAuthGuard,
  JwksVerifier,
  parseInternalSecrets,
} = authShared;
const { createTestApp, createJwtTestIssuer } = testUtils;
const secrets = parseInternalSecrets(
  JSON.stringify({
    "order-service": [
      "new:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "old:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ],
    "seller-service": ["other:cccccccccccccccccccccccccccccccc"],
  }),
);

function route(controller, path, method, guard) {
  Controller(path)(controller);
  Get()(
    controller.prototype,
    method,
    Object.getOwnPropertyDescriptor(controller.prototype, method),
  );
  UseGuards(guard)(
    controller.prototype,
    method,
    Object.getOwnPropertyDescriptor(controller.prototype, method),
  );
  class AppModule {}
  Module({ controllers: [controller] })(AppModule);
  return AppModule;
}

test("service tokens enforce audience, rotation, type, time and signature", () => {
  const verifier = new InternalTokenVerifier("order-service", secrets);
  const current = new InternalTokenSigner("seller-service", secrets).sign("order-service");
  const previous = new InternalTokenSigner("seller-service", {
    "order-service": [secrets["order-service"][1]],
  }).sign("order-service");
  assert.equal(verifier.verify(current).iss, "seller-service");
  assert.equal(verifier.verify(previous).aud, "order-service");
  assert.throws(() => new InternalTokenVerifier("seller-service", secrets).verify(current));
  const [header, payload, sig] = current.split(".");
  const edited = (claims) => {
    const data = `${header}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}`;
    return `${data}.${createHmac("sha256", secrets["order-service"][0].secret).update(data).digest("base64url")}`;
  };
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  for (const change of [
    { typ: "user" },
    { iat: claims.iat + 30 },
    { exp: claims.exp + 1 },
    { aud: "seller-service" },
  ])
    assert.throws(() => verifier.verify(edited({ ...claims, ...change })));
  assert.throws(() =>
    verifier.verify(`${header}.${payload}.${Buffer.alloc(32).toString("base64url")}`),
  );
  assert.throws(() => parseInternalSecrets('{"order-service":["x:short"]}'));
  assert.throws(() =>
    parseInternalSecrets(
      '{"order-service":["x:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","x:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"]}',
    ),
  );
});

test("two Nest services separate service and user tokens", async () => {
  const issuer = await createJwtTestIssuer();
  const userToken = await issuer.sign();
  const signer = new InternalTokenSigner("seller-service", secrets);
  const otherSigner = new InternalTokenSigner("seller-service", {
    "seller-service": secrets["seller-service"],
  });
  class OrderController {
    get() {
      return { ok: true };
    }
  }
  class SellerController {
    get() {
      return { ok: true };
    }
  }
  class UserController {
    get() {
      return { ok: true };
    }
  }
  const order = await createTestApp(
    route(
      OrderController,
      "internal/order",
      "get",
      new InternalAuthGuard(new InternalTokenVerifier("order-service", secrets)),
    ),
  );
  const seller = await createTestApp(
    route(
      SellerController,
      "internal/seller",
      "get",
      new InternalAuthGuard(new InternalTokenVerifier("seller-service", secrets)),
    ),
  );
  const user = await createTestApp(
    route(
      UserController,
      "user",
      "get",
      new JwtAuthGuard(new JwksVerifier(issuer.issuer, issuer.jwksUrl)),
    ),
  );
  try {
    const token = signer.sign("order-service");
    await order.request
      .get("/internal/order")
      .set("Authorization", `Bearer ${userToken}`)
      .expect(401);
    await order.request
      .get("/internal/order")
      .set("Authorization", `Bearer ${otherSigner.sign("seller-service")}`)
      .expect(401);
    await order.request.get("/internal/order").set("Authorization", `Bearer ${token}`).expect(200);
    const oldSigner = new InternalTokenSigner("seller-service", {
      "order-service": [secrets["order-service"][1]],
    });
    await order.request
      .get("/internal/order")
      .set("Authorization", `Bearer ${oldSigner.sign("order-service")}`)
      .expect(200);
    await seller.request
      .get("/internal/seller")
      .set("Authorization", `Bearer ${token}`)
      .expect(401);
    await user.request.get("/user").set("Authorization", `Bearer ${token}`).expect(401);
    await user.request.get("/user").set("Authorization", `Bearer ${userToken}`).expect(200);
  } finally {
    await Promise.all([order.close(), seller.close(), user.close(), issuer.close()]);
  }
});

test("@Internal() resolves the guard and requires service configuration", async () => {
  const previousName = process.env.SERVICE_NAME;
  const previousSecrets = process.env.INTERNAL_JWT_SECRETS;
  process.env.SERVICE_NAME = "order-service";
  process.env.INTERNAL_JWT_SECRETS = JSON.stringify({
    "order-service": secrets["order-service"].map(({ kid, secret }) => `${kid}:${secret}`),
  });
  class ControllerUnderTest {
    get() {
      return { ok: true };
    }
  }
  Controller("internal/check")(ControllerUnderTest);
  Get()(
    ControllerUnderTest.prototype,
    "get",
    Object.getOwnPropertyDescriptor(ControllerUnderTest.prototype, "get"),
  );
  Internal()(
    ControllerUnderTest.prototype,
    "get",
    Object.getOwnPropertyDescriptor(ControllerUnderTest.prototype, "get"),
  );
  class AppModule {}
  Module({ controllers: [ControllerUnderTest] })(AppModule);
  try {
    const app = await createTestApp(AppModule);
    try {
      await app.request.get("/internal/check").expect(401);
      const token = new InternalTokenSigner("seller-service", secrets).sign("order-service");
      await app.request.get("/internal/check").set("Authorization", `Bearer ${token}`).expect(200);
    } finally {
      await app.close();
    }
  } finally {
    if (previousName === undefined) delete process.env.SERVICE_NAME;
    else process.env.SERVICE_NAME = previousName;
    if (previousSecrets === undefined) delete process.env.INTERNAL_JWT_SECRETS;
    else process.env.INTERNAL_JWT_SECRETS = previousSecrets;
  }
});

test("client signs each call, passes request ID, and retries only eligible failures", async () => {
  const signer = new InternalTokenSigner("seller-service", secrets);
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    return new Response("result", { status: calls.length === 1 ? 503 : 200 });
  };
  const client = new InternalHttpClient(signer, "order-service", "http://localhost:4004", fetcher);
  assert.equal((await client.request("/internal/price", {}, "request-123")).status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.headers.get("X-Request-Id"), "request-123");
  assert.equal(
    new InternalTokenVerifier("order-service", secrets).verify(
      calls[0].init.headers.get("Authorization").slice(7),
    ).aud,
    "order-service",
  );
  calls.length = 0;
  assert.equal((await client.request("/internal/reserve", { method: "POST" })).status, 503);
  assert.equal(calls.length, 1);
  await assert.rejects(client.request("/public/price"));
});
