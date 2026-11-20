import { Injectable } from "@nestjs/common";
import Stripe from "stripe";
import { paymentEnvSchema, type PaymentConfig } from "../config";

export type StripeWebhookScope = "account" | "connect";

@Injectable()
export class StripeProvider {
  readonly config: PaymentConfig;
  readonly client: Stripe;

  constructor() {
    this.config = paymentEnvSchema.parse(process.env);
    this.client = new Stripe(this.config.STRIPE_SECRET_KEY);
  }

  verify(rawBody: Buffer, signature: string, scope: StripeWebhookScope): Stripe.Event {
    const secret =
      scope === "account"
        ? this.config.STRIPE_ACCOUNT_WEBHOOK_SECRET
        : this.config.STRIPE_CONNECT_WEBHOOK_SECRET;
    return this.client.webhooks.constructEvent(rawBody, signature, secret);
  }
}
