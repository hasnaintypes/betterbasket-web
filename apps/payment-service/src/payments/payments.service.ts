import { Injectable } from "@nestjs/common";
import { db } from "../db/client";
import { payments } from "../db/schema";
import { StripeProvider } from "./stripe.provider";

const PLATFORM_FEE_BPS = Number(process.env.PLATFORM_FEE_BPS);

@Injectable()
export class PaymentsService {
  constructor(private readonly stripeProvider: StripeProvider) {}

  /** One PaymentIntent per (order, seller) sub-order — see db/schema.ts comment. */
  async createPaymentIntent(
    orderId: string,
    amount: number,
    currency: string,
    connectedAccountId: string,
  ) {
    const applicationFeeAmount = Math.round((amount * PLATFORM_FEE_BPS) / 10_000);

    const intent = await this.stripeProvider.client.paymentIntents.create({
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
}
