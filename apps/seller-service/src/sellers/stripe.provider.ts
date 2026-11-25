import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import Stripe from "stripe";
import { sellerEnvSchema, type SellerConfig } from "../config";

@Injectable()
export class SellerStripeProvider {
  readonly config: SellerConfig;
  readonly client: Stripe;

  constructor() {
    this.config = sellerEnvSchema.parse(process.env);
    this.client = new Stripe(this.config.STRIPE_SECRET_KEY);
  }

  async createAccount(sellerId: string, country: string) {
    try {
      return await this.client.accounts.create(
        {
          country,
          controller: {
            fees: { payer: "application" },
            losses: { payments: "application" },
            stripe_dashboard: { type: "express" },
          },
          capabilities: { transfers: { requested: true } },
        },
        { idempotencyKey: `acct:${sellerId}` },
      );
    } catch {
      throw new ServiceUnavailableException({ code: "UPSTREAM_UNAVAILABLE" });
    }
  }

  async createOnboardingLink(accountId: string) {
    const origin = this.config.ALLOWED_FRONTEND_ORIGINS.split(",")[0]!.trim();
    try {
      return await this.client.accountLinks.create({
        account: accountId,
        type: "account_onboarding",
        return_url: new URL("/seller/onboarding/return", origin).toString(),
        refresh_url: new URL("/seller/onboarding/refresh", origin).toString(),
      });
    } catch {
      throw new ServiceUnavailableException({ code: "UPSTREAM_UNAVAILABLE" });
    }
  }
}
