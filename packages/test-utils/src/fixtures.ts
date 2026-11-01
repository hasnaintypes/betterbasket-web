import type { User, Seller, Product, Order } from "@betterbasket/contracts";

const date = new Date("2025-01-01T00:00:00.000Z");
const money = { amount: 1000, currency: "USD" } as const;

export function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    email: "user@example.test",
    name: "Test User",
    role: "customer",
    emailVerified: true,
    banned: false,
    createdAt: new Date(date),
    ...overrides,
  };
}
export function buildSeller(overrides: Partial<Seller> = {}): Seller {
  return {
    id: "seller-1",
    organizationId: "org-1",
    storeName: "Test Store",
    slug: "test-store",
    status: "active",
    createdAt: new Date(date),
    ...overrides,
  };
}
export function buildProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "product-1",
    sellerId: "seller-1",
    organizationId: "org-1",
    title: "Test Product",
    slug: "test-product",
    description: "",
    images: [],
    category: "test",
    basePrice: { ...money },
    variants: [],
    status: "active",
    createdAt: new Date(date),
    updatedAt: new Date(date),
    ...overrides,
  };
}
export function buildOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "order-1",
    buyerId: "user-1",
    items: [
      {
        productId: "product-1",
        sellerId: "seller-1",
        title: "Test Product",
        unitPrice: { ...money },
        quantity: 1,
      },
    ],
    subtotal: { ...money },
    shippingTotal: { amount: 0, currency: "USD" },
    total: { ...money },
    status: "pending",
    createdAt: new Date(date),
    updatedAt: new Date(date),
    ...overrides,
  };
}
