import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthTokenClaimsSchema, CapabilitySchema, PlatformRoleSchema } from "../dist/index.js";

const claims = {
  sub: "user-42",
  email: "buyer@example.test",
  emailVerified: true,
  platformRole: "customer",
  orgId: "org-7",
  orgRole: "owner",
  iss: "https://api.example.test",
  aud: "https://api.example.test",
  iat: 1_700_000_000,
  exp: 1_700_000_900,
  jti: "token-1",
};

test("v2 token claims parse with typed platform and organization roles", () => {
  assert.deepEqual(AuthTokenClaimsSchema.parse(claims), claims);
  assert.deepEqual(AuthTokenClaimsSchema.parse({ ...claims, orgId: null, orgRole: null }), {
    ...claims,
    orgId: null,
    orgRole: null,
  });
});

test("seller is not a platform role and old claim names cannot replace v2 fields", () => {
  assert.equal(PlatformRoleSchema.safeParse("seller").success, false);
  assert.equal(
    AuthTokenClaimsSchema.safeParse({ ...claims, platformRole: "seller" }).success,
    false,
  );
  const oldClaims = { ...claims, role: claims.platformRole, activeOrganizationId: claims.orgId };
  delete oldClaims.platformRole;
  delete oldClaims.orgId;
  delete oldClaims.orgRole;
  assert.equal(AuthTokenClaimsSchema.safeParse(oldClaims).success, false);
});

test("capability names are enumerated", () => {
  for (const name of ["product:read", "order:cancel", "member:manage", "admin:*"]) {
    assert.equal(CapabilitySchema.parse(name), name);
  }
  assert.equal(CapabilitySchema.safeParse("product:delete").success, false);
});
