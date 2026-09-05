import { z } from "zod";
import { MoneySchema } from "./common.js";

export const PaymentStatusSchema = z.enum([
  "requires_payment",
  "processing",
  "succeeded",
  "failed",
  "refunded",
]);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

/** Lives in payment-service's Postgres DB. One row per Stripe PaymentIntent. */
export const PaymentSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  stripePaymentIntentId: z.string(),
  amount: MoneySchema,
  status: PaymentStatusSchema,
  createdAt: z.coerce.date(),
});
export type Payment = z.infer<typeof PaymentSchema>;

/** One row per seller payout split via Stripe Connect application_fee / transfer. */
export const PayoutLedgerEntrySchema = z.object({
  id: z.string(),
  paymentId: z.string(),
  sellerId: z.string(),
  stripeAccountId: z.string(),
  grossAmount: MoneySchema,
  platformFee: MoneySchema,
  netAmount: MoneySchema,
  stripeTransferId: z.string().nullish(),
  createdAt: z.coerce.date(),
});
export type PayoutLedgerEntry = z.infer<typeof PayoutLedgerEntrySchema>;
