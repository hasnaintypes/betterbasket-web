import { Injectable, Logger } from "@nestjs/common";
import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { db } from "../db/client";
import { payments, type paymentStatusEnum } from "../db/schema";

const PLATFORM_FEE_BPS = Number(process.env.PLATFORM_FEE_BPS ?? 1000); // 10% default

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "sk_test_placeholder");

  /** One PaymentIntent per (order, seller) sub-order — see db/schema.ts comment. */
  async createPaymentIntent(orderId: string, amount: number, currency: string, connectedAccountId: string) {
    const applicationFeeAmount = Math.round((amount * PLATFORM_FEE_BPS) / 10_000);

    const intent = await this.stripe.paymentIntents.create({
      amount,
      currency,
      application_fee_amount: applicationFeeAmount,
      transfer_data: { destination: connectedAccountId },
      metadata: { orderId },
    });

    const [payment] = await db
      .insert(payments)
      .values({
        orderId,
        stripePaymentIntentId: intent.id,
        connectedAccountId,
        amount,
        currency,
        status: "requires_payment",
      })
      .returning();

    return { clientSecret: intent.client_secret, payment };
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string): Stripe.Event {
    return this.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET ?? "",
    );
  }

  async handlePaymentIntentEvent(event: Stripe.Event) {
    const intent = event.data.object as Stripe.PaymentIntent;
    const status: (typeof paymentStatusEnum.enumValues)[number] =
      event.type === "payment_intent.succeeded"
        ? "succeeded"
        : event.type === "payment_intent.payment_failed"
          ? "failed"
          : "processing";

    await db
      .update(payments)
      .set({ status })
      .where(eq(payments.stripePaymentIntentId, intent.id));

    this.logger.log(`Payment ${intent.id} -> ${status}`);
    // TODO(Tier 3): publish Topics.PaymentSucceeded / Topics.PaymentFailed so
    // order-service and notification-service react (order status, receipts).
  }
}
