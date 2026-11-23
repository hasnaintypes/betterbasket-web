import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { Controller, Get } from "@nestjs/common";

const require = createRequire(import.meta.url);
const {
  JwtAuthGuard,
  CapabilityGuard,
  DefaultCapabilityResolver,
  Public,
  Capability,
  HighRisk,
  Internal,
} = require("@betterbasket/auth-shared");
const { assertRoutesDeclared } = require("../dist/index.js");

const claims = {
  sub: "buyer-1",
  email: "buyer@example.test",
  emailVerified: true,
  platformRole: "customer",
  orgId: null,
  orgRole: null,
  iss: "https://example.test",
  aud: "https://example.test",
  iat: 1,
  exp: 9999999999,
  jti: "token-1",
};

function context(handler, request = {}) {
  return {
    getHandler: () => handler,
    getClass: () => Route,
    switchToHttp: () => ({ getRequest: () => request }),
  };
}

class Route {
  open() {}
  buy() {}
  missing() {}
  seller() {}
  admin() {}
  internal() {}
}
Controller("probe")(Route);
for (const name of ["open", "buy", "missing", "seller", "admin", "internal"])
  Get(name)(Route.prototype, name, Object.getOwnPropertyDescriptor(Route.prototype, name));
Public()(Route.prototype, "open", Object.getOwnPropertyDescriptor(Route.prototype, "open"));
Capability("order:create")(
  Route.prototype,
  "buy",
  Object.getOwnPropertyDescriptor(Route.prototype, "buy"),
);
Capability("product:publish")(
  Route.prototype,
  "seller",
  Object.getOwnPropertyDescriptor(Route.prototype, "seller"),
);
HighRisk()(Route.prototype, "seller", Object.getOwnPropertyDescriptor(Route.prototype, "seller"));
Capability("admin:*")(
  Route.prototype,
  "admin",
  Object.getOwnPropertyDescriptor(Route.prototype, "admin"),
);
Internal()(
  Route.prototype,
  "internal",
  Object.getOwnPropertyDescriptor(Route.prototype, "internal"),
);

test("route inspector names undecorated handlers", () => {
  assert.throws(() => assertRoutesDeclared([Route]), /Route\.missing \/probe\/missing/);
});

test("JWT guard requires a bearer token and attaches verified claims", async () => {
  const guard = new JwtAuthGuard({ verify: async () => claims });
  await assert.rejects(guard.canActivate(context(Route.prototype.buy, { headers: {} })), {
    status: 401,
  });
  const request = { headers: { authorization: "Bearer test" } };
  assert.equal(await guard.canActivate(context(Route.prototype.buy, request)), true);
  assert.deepEqual(request.user, claims);
  assert.equal(await guard.canActivate(context(Route.prototype.open, { headers: {} })), true);
});

test("internal routes bypass user guards and retain their internal guard", async () => {
  const request = { headers: {} };
  assert.equal(
    await new JwtAuthGuard().canActivate(context(Route.prototype.internal, request)),
    true,
  );
  assert.equal(
    await new CapabilityGuard().canActivate(context(Route.prototype.internal, request)),
    true,
  );
  const guarded = Reflect.getMetadata("__guards__", Route.prototype.internal);
  assert.equal(guarded.length, 1);
});

test("buyer capabilities require verified email, including for admins", async () => {
  const guard = new CapabilityGuard();
  for (const platformRole of ["customer", "admin"]) {
    const user = { ...claims, platformRole, emailVerified: false };
    await assert.rejects(
      guard.canActivate(context(Route.prototype.buy, { user })),
      (error) => error.status === 403 && error.response.code === "EMAIL_NOT_VERIFIED",
    );
    assert.equal(
      await guard.canActivate(
        context(Route.prototype.buy, { user: { ...user, emailVerified: true } }),
      ),
      true,
    );
  }
});

test("missing metadata and seller access fail closed; admins can use admin routes", async () => {
  const guard = new CapabilityGuard();
  await assert.rejects(guard.canActivate(context(Route.prototype.missing, { user: claims })), {
    status: 403,
  });
  await assert.rejects(guard.canActivate(context(Route.prototype.seller, { user: claims })), {
    status: 403,
  });
  await assert.rejects(guard.canActivate(context(Route.prototype.admin, { user: claims })), {
    status: 403,
  });
  assert.equal(
    await guard.canActivate(
      context(Route.prototype.admin, { user: { ...claims, platformRole: "admin" } }),
    ),
    true,
  );
});

test("seller provider receives high-risk marker and sets tenant only after access", async () => {
  let seen;
  const resolver = new DefaultCapabilityResolver({
    resolve: async (user, capability, highRisk) => {
      seen = { user, capability, highRisk };
      return { sellerId: "seller-1" };
    },
  });
  const request = { user: claims };
  assert.equal(
    await new CapabilityGuard(resolver).canActivate(context(Route.prototype.seller, request)),
    true,
  );
  assert.deepEqual(request.tenant, { sellerId: "seller-1" });
  assert.equal(seen.highRisk, true);
  assert.equal(seen.capability, "product:publish");
});

test("seller decision without a tenant fails closed", async () => {
  const guard = new CapabilityGuard({ resolve: async () => ({ allowed: true }) });
  await assert.rejects(guard.canActivate(context(Route.prototype.seller, { user: claims })), {
    status: 403,
  });
});

test("custom resolvers cannot grant buyer or admin routes across fixed identity rules", async () => {
  const guard = new CapabilityGuard({ resolve: async () => ({ allowed: true }) });
  await assert.rejects(
    guard.canActivate(context(Route.prototype.buy, { user: { ...claims, emailVerified: false } })),
    (error) => error.status === 403 && error.response.code === "EMAIL_NOT_VERIFIED",
  );
  await assert.rejects(guard.canActivate(context(Route.prototype.admin, { user: claims })), {
    status: 403,
  });
});
