import { ServiceUnavailableException } from "@nestjs/common";
import { SellerStripeProvider } from "./stripe.provider";

const validEnv = {
  NODE_ENV: "test",
  PORT: "4003",
  AUTH_ISSUER: "https://issuer.example.test",
  AUTH_JWKS_URL: "https://issuer.example.test/jwks",
  DATABASE_URL: "postgresql://user:password@db.example.test/db",
  STRIPE_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaa",
  ALLOWED_FRONTEND_ORIGINS: "https://seller.example.test",
  KAFKA_BROKERS: "broker.example.test:9092",
  KAFKA_USERNAME: "user",
  KAFKA_PASSWORD: "password",
  KAFKA_TOPIC_PREFIX: "test.",
};

describe("SellerStripeProvider", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => Object.assign(process.env, validEnv));
  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it("creates only a transfers-capable test account with a stable idempotency key", async () => {
    const provider = new SellerStripeProvider();
    const create = jest
      .spyOn(provider.client.accounts, "create")
      .mockResolvedValue({ id: "acct_test" } as never);
    await expect(provider.createAccount("seller-1", "US")).resolves.toMatchObject({
      id: "acct_test",
    });
    expect(create).toHaveBeenCalledWith(
      {
        country: "US",
        controller: {
          fees: { payer: "application" },
          losses: { payments: "application" },
          stripe_dashboard: { type: "express" },
        },
        capabilities: { transfers: { requested: true } },
      },
      { idempotencyKey: "acct:seller-1" },
    );
  });

  it("derives both redirects from configuration and hides provider errors", async () => {
    const provider = new SellerStripeProvider();
    const create = jest
      .spyOn(provider.client.accountLinks, "create")
      .mockResolvedValue({ url: "https://connect.stripe.test/link" } as never);
    await provider.createOnboardingLink("acct_test");
    expect(create).toHaveBeenCalledWith({
      account: "acct_test",
      type: "account_onboarding",
      return_url: "https://seller.example.test/seller/onboarding/return",
      refresh_url: "https://seller.example.test/seller/onboarding/refresh",
    });
    create.mockRejectedValueOnce(new Error("raw secret provider detail"));
    await expect(provider.createOnboardingLink("acct_test")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
