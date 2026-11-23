import { BadRequestException, ForbiddenException, type ExecutionContext } from "@nestjs/common";
import {
  CAPABILITY_KEY,
  CapabilityGuard,
  DefaultCapabilityResolver,
} from "@betterbasket/auth-shared";
import { CreateSellerInputSchema, type AuthTokenClaims } from "@betterbasket/contracts";
import { SellersController } from "./sellers.controller";

const owner: AuthTokenClaims = {
  sub: "owner-1",
  email: "owner@example.test",
  emailVerified: true,
  platformRole: "customer",
  orgId: "org-1",
  orgRole: "owner",
  iss: "https://issuer.example.test",
  aud: "https://audience.example.test",
  iat: 1,
  exp: 2,
  jti: "token-1",
};

describe("seller registration authorization", () => {
  const resolver = new DefaultCapabilityResolver();

  it("allows only a verified owner to register; other seller capabilities stay denied", async () => {
    await expect(resolver.resolve(owner, "seller:register", false)).resolves.toEqual({
      allowed: true,
    });
    await expect(
      resolver.resolve({ ...owner, orgRole: "member" }, "seller:register", false),
    ).resolves.toEqual({ allowed: false });
    await expect(
      resolver.resolve({ ...owner, emailVerified: false }, "seller:register", false),
    ).resolves.toEqual({ allowed: false, reason: "EMAIL_NOT_VERIFIED" });
    await expect(resolver.resolve(owner, "seller:write", false)).resolves.toEqual({
      allowed: false,
    });
  });

  it("returns an actionable 400 for a verified user without an active organization", async () => {
    await expect(
      resolver.resolve({ ...owner, orgId: null, orgRole: null }, "seller:register", false),
    ).resolves.toEqual({ allowed: true });
    const service = { onboard: jest.fn() };
    const controller = new SellersController(service as never);
    expect(() =>
      controller.onboard(
        { user: { ...owner, orgId: null } },
        {
          storeName: "Test Store",
          slug: "test-store",
          country: "US",
          supportEmail: "support@example.test",
        },
      ),
    ).toThrow(BadRequestException);
    expect(service.onboard).not.toHaveBeenCalled();
  });

  it("rejects a non-owner even when a custom resolver grants registration", async () => {
    const handler = () => undefined;
    Reflect.defineMetadata(CAPABILITY_KEY, "seller:register", handler);
    const context = {
      getHandler: () => handler,
      getClass: () => SellersController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { ...owner, orgRole: "member" } }),
      }),
    } as unknown as ExecutionContext;
    const guard = new CapabilityGuard({ resolve: async () => ({ allowed: true }) });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe("seller registration contract", () => {
  const valid = {
    storeName: "Test Store",
    slug: "test-store",
    country: "US",
    supportEmail: "support@example.test",
  };

  it("requires country and support email and rejects unknown fields", () => {
    expect(CreateSellerInputSchema.safeParse(valid).success).toBe(true);
    expect(CreateSellerInputSchema.safeParse({ ...valid, country: "USA" }).success).toBe(false);
    expect(CreateSellerInputSchema.safeParse({ ...valid, country: "ZZ" }).success).toBe(false);
    expect(CreateSellerInputSchema.safeParse({ ...valid, supportEmail: "invalid" }).success).toBe(
      false,
    );
    expect(CreateSellerInputSchema.safeParse({ ...valid, organizationId: "foreign" }).success).toBe(
      false,
    );
  });
});
