import { ForbiddenException } from "@nestjs/common";
import { DefaultCapabilityResolver } from "@betterbasket/auth-shared";
import type { AuthTokenClaims } from "@betterbasket/contracts";
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

describe("Stripe onboarding controller", () => {
  const service = { createStripeAccount: jest.fn(), createOnboardingLink: jest.fn() };
  const controller = new SellersController(service as never);

  beforeEach(() => jest.clearAllMocks());

  it("forwards only the verified owner's organization and identity", () => {
    controller.createStripeAccount({ user: owner });
    controller.onboardingLink({ user: owner });
    expect(service.createStripeAccount).toHaveBeenCalledWith("org-1", "owner-1");
    expect(service.createOnboardingLink).toHaveBeenCalledWith("org-1");
  });

  it("rejects a non-owner and an unverified owner", () => {
    expect(() => controller.createStripeAccount({ user: { ...owner, orgRole: "member" } })).toThrow(
      ForbiddenException,
    );
    expect(() => controller.onboardingLink({ user: { ...owner, emailVerified: false } })).toThrow(
      ForbiddenException,
    );
    expect(service.createStripeAccount).not.toHaveBeenCalled();
    expect(service.createOnboardingLink).not.toHaveBeenCalled();
  });

  it("stays denied until a live seller-access provider is installed", async () => {
    await expect(
      new DefaultCapabilityResolver().resolve(owner, "stripe:manage", true),
    ).resolves.toEqual({ allowed: false });
  });
});
