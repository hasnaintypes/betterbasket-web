import { z } from "zod";
import { MoneySchema } from "./common.js";

const id = z.string().trim().min(1).max(128);

export const ReservationRequestSchema = z.strictObject({
  orderId: id,
  lines: z
    .array(
      z.strictObject({
        lineId: id,
        productId: id,
        variantId: id,
        quantity: z.number().int().min(1).max(99),
      }),
    )
    .min(1)
    .max(50),
});
export type ReservationRequest = z.infer<typeof ReservationRequestSchema>;

export const ReservationResponseSchema = z.strictObject({
  orderId: id,
  lines: z
    .array(
      z.strictObject({
        lineId: id,
        unitPrice: MoneySchema,
        sellerId: id,
        titleSnapshot: z.string().min(1).max(300),
        sku: z.string().min(1).max(128),
      }),
    )
    .min(1)
    .max(50),
  expiresAt: z.iso.datetime({ offset: true }),
});
export type ReservationResponse = z.infer<typeof ReservationResponseSchema>;
