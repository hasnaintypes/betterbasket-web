import { z } from "zod";

const label = z.string().trim().min(1).max(200);
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const amount = z.number().int().nonnegative();
const currency = z.literal("USD");

const item = z.strictObject({
  name: label,
  quantity: z.number().int().positive().max(999),
  unitPriceMinor: amount,
});

const order = { orderId: identifier, customerName: label };

export const TemplateDataSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("order-confirmation"),
    ...order,
    currency,
    totalMinor: amount,
    items: z.array(item).min(1).max(500),
  }),
  z.strictObject({ kind: z.literal("payment-failed"), ...order }),
  z.strictObject({
    kind: z.literal("order-shipped"),
    ...order,
    carrier: label.optional(),
    trackingNumber: label.optional(),
  }),
  z.strictObject({ kind: z.literal("order-delivered"), ...order }),
  z.strictObject({ kind: z.literal("order-cancelled"), ...order }),
  z.strictObject({
    kind: z.literal("refund-issued"),
    ...order,
    currency,
    amountMinor: amount,
  }),
  z.strictObject({
    kind: z.literal("seller-new-order"),
    orderId: identifier,
    storeName: label,
  }),
  z.strictObject({ kind: z.literal("seller-approved"), storeName: label }),
  z.strictObject({ kind: z.literal("seller-suspended"), storeName: label }),
]);

export type TemplateData = z.infer<typeof TemplateDataSchema>;

export interface TemplateOrigins {
  storefrontOrigin: string;
  sellerPortalOrigin: string;
  allowedOrigins: readonly string[];
}

function originOnly(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.origin !== value.replace(/\/$/, "")
  ) {
    throw new Error("Template link origin is not allowed");
  }
  return url.origin;
}

export function templateLinks(config: TemplateOrigins, orderId?: string) {
  const allowed = new Set(config.allowedOrigins.map(originOnly));
  const storefront = originOnly(config.storefrontOrigin);
  const sellerPortal = originOnly(config.sellerPortalOrigin);
  if (!allowed.has(storefront) || !allowed.has(sellerPortal)) {
    throw new Error("Template link origin is not allowed");
  }
  return {
    buyer: orderId ? `${storefront}/account/orders/${encodeURIComponent(orderId)}` : storefront,
    seller: orderId ? `${sellerPortal}/orders/${encodeURIComponent(orderId)}` : sellerPortal,
  };
}
