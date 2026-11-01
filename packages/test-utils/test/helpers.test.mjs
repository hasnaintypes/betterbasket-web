import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { Controller, Get, Module } from "@nestjs/common";
import authShared from "@betterbasket/auth-shared";
import { UserSchema, SellerSchema, ProductSchema, OrderSchema } from "@betterbasket/contracts";
import testUtils from "../dist/index.js";

const { JwksVerifier } = authShared;
const {
  createStubUpstream,
  createJwtTestIssuer,
  createTestApp,
  buildUser,
  buildSeller,
  buildProduct,
  buildOrder,
  createTestClock,
} = testUtils;

test("stub upstream records exact request body hash and scripts responses", async () => {
  const stub = await createStubUpstream();
  try {
    stub.enqueue({ status: 201, headers: { "x-stub": "yes" }, body: "created" });
    const body = Buffer.from([0, 1, 2, 255]);
    const response = await fetch(`${stub.url}/items?q=1`, { method: "POST", body });
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("x-stub"), "yes");
    assert.equal(await response.text(), "created");
    assert.equal(stub.requests[0].method, "POST");
    assert.equal(stub.requests[0].url, "/items?q=1");
    assert.deepEqual(stub.requests[0].body, body);
    assert.equal(stub.requests[0].bodySha256, createHash("sha256").update(body).digest("hex"));
  } finally {
    await stub.close();
  }
});

test("stub upstream supports upgrade requests", async () => {
  const stub = await createStubUpstream();
  try {
    stub.onUpgrade((_request, socket) => {
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: test\r\n\r\n",
      );
      socket.end();
    });
    const { connect } = await import("node:net");
    const socket = connect(new URL(stub.url).port, "127.0.0.1");
    let data = "";
    await new Promise((resolve, reject) => {
      socket.on("data", (chunk) => {
        data += chunk.toString();
      });
      socket.on("end", resolve);
      socket.on("error", reject);
      socket.write(
        "GET /socket HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: test\r\n\r\n",
      );
    });
    assert.match(data, /101 Switching Protocols/);
    assert.equal(stub.requests[0].url, "/socket");
  } finally {
    await stub.close();
  }
});

test("JWT issuer verifies v2 claims and rejects tampering", async () => {
  const issuer = await createJwtTestIssuer();
  try {
    const token = await issuer.sign({
      sub: "user-42",
      role: "seller",
      activeOrganizationId: "org-7",
    });
    const verifier = new JwksVerifier(issuer.issuer, issuer.jwksUrl);
    const claims = await verifier.verify(token);
    assert.equal(claims.sub, "user-42");
    assert.equal(claims.role, "seller");
    assert.equal(claims.activeOrganizationId, "org-7");
    const [header, payload, signature] = token.split(".");
    const modified = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload, "base64url").toString()),
        sub: "attacker",
      }),
    ).toString("base64url");
    await assert.rejects(verifier.verify(`${header}.${modified}.${signature}`));
  } finally {
    await issuer.close();
  }
});

test("Nest app helper starts and closes an in-memory app", async () => {
  class HealthController {
    health() {
      return { status: "ok" };
    }
  }
  Controller("health")(HealthController);
  Get()(
    HealthController.prototype,
    "health",
    Object.getOwnPropertyDescriptor(HealthController.prototype, "health"),
  );
  class TestModule {}
  Module({ controllers: [HealthController] })(TestModule);
  const harness = await createTestApp(TestModule);
  try {
    await harness.request.get("/health").expect(200, { status: "ok" });
  } finally {
    await harness.close();
  }
});

test("synthetic fixtures satisfy contract schemas and accept overrides", () => {
  assert.equal(UserSchema.parse(buildUser({ id: "user-2" })).id, "user-2");
  SellerSchema.parse(buildSeller());
  ProductSchema.parse(buildProduct());
  OrderSchema.parse(buildOrder());
});

test("test clock advances deterministically and rejects invalid times", () => {
  const clock = createTestClock();
  assert.equal(clock.now().toISOString(), "2025-01-01T00:00:00.000Z");
  assert.equal(clock.advanceBy(1000).toISOString(), "2025-01-01T00:00:01.000Z");
  assert.equal(clock.set("2026-01-01T00:00:00Z").getUTCFullYear(), 2026);
  assert.throws(() => clock.advanceBy(Infinity));
});
