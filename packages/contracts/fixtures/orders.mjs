const money = (amount) => ({ amount, currency: "USD" });
const now = "2026-11-16T00:00:00Z";

export const shippingAddress = {
  name: "Example Buyer",
  line1: "10 Market Street",
  city: "Karachi",
  region: "Sindh",
  postalCode: "74000",
  country: "PK",
};

export const createOrderInput = {
  items: [{ productId: "product-1", variantId: "variant-1", quantity: 2 }],
  shippingAddress,
  expectedTotal: money(2100),
};

export const reservationRequest = {
  orderId: "order-1",
  lines: [{ lineId: "line-1", productId: "product-1", variantId: "variant-1", quantity: 2 }],
};

export const reservationResponse = {
  orderId: "order-1",
  lines: [
    {
      lineId: "line-1",
      unitPrice: money(1000),
      sellerId: "seller-1",
      titleSnapshot: "Example Product",
      sku: "EXAMPLE-1",
    },
  ],
  expiresAt: now,
};

const line = {
  lineId: "line-1",
  productId: "product-1",
  variantId: "variant-1",
  sellerId: "seller-1",
  titleSnapshot: "Example Product",
  sku: "EXAMPLE-1",
  quantity: 2,
  unitPrice: money(1000),
  lineTotal: money(2000),
};

export const subOrderView = {
  id: "sub-order-1",
  orderId: "order-1",
  sellerId: "seller-1",
  status: "awaiting_payment",
  items: [line],
  subtotal: money(2000),
  shippingTotal: money(100),
  total: money(2100),
  createdAt: now,
  updatedAt: now,
};

export const orderView = {
  id: "order-1",
  buyerId: "buyer-1",
  status: "awaiting_payment",
  refundStatus: "none",
  subOrders: [subOrderView],
  shippingAddress,
  subtotal: money(2000),
  shippingTotal: money(100),
  total: money(2100),
  expiresAt: now,
  createdAt: now,
  updatedAt: now,
};

export const payableOrderView = {
  orderId: "order-1",
  buyerId: "buyer-1",
  status: "awaiting_payment",
  total: money(2100),
  expiresAt: now,
  subOrders: [{ id: "sub-order-1", sellerId: "seller-1", total: money(2100) }],
};
