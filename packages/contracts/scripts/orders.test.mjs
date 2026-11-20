import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CreateOrderInputSchema,
  OrderStatusSchema,
  SubOrderStatusSchema,
  RefundStatusSchema,
  OrderViewSchema,
  SubOrderViewSchema,
  PayableOrderViewSchema,
  ReservationRequestSchema,
  ReservationResponseSchema,
} from "../dist/index.js";
import {
  createOrderInput,
  orderView,
  payableOrderView,
  reservationRequest,
  reservationResponse,
  subOrderView,
} from "../fixtures/orders.mjs";

test("valid order, reservation, and payable fixtures parse", () => {
  for (const [schema, fixture] of [
    [CreateOrderInputSchema, createOrderInput],
    [ReservationRequestSchema, reservationRequest],
    [ReservationResponseSchema, reservationResponse],
    [SubOrderViewSchema, subOrderView],
    [OrderViewSchema, orderView],
    [PayableOrderViewSchema, payableOrderView],
  ])
    assert.deepEqual(schema.parse(fixture), fixture);
});

test("client-supplied prices and unknown monetary fields are rejected", () => {
  for (const input of [
    { ...createOrderInput, unitPrice: { amount: 1, currency: "USD" } },
    { ...createOrderInput, total: { amount: 1, currency: "USD" } },
    { ...createOrderInput, items: [{ ...createOrderInput.items[0], unitPrice: 1 }] },
    { ...createOrderInput, expectedTotal: { amount: 2100, currency: "USD", shipping: 1 } },
  ])
    assert.equal(CreateOrderInputSchema.safeParse(input).success, false);
});

test("shipping address is required, capped, and uses an uppercase country code", () => {
  assert.equal(CreateOrderInputSchema.safeParse({ items: createOrderInput.items }).success, false);
  assert.equal(
    CreateOrderInputSchema.safeParse({
      ...createOrderInput,
      shippingAddress: { ...createOrderInput.shippingAddress, line1: "x".repeat(201) },
    }).success,
    false,
  );
  assert.equal(
    CreateOrderInputSchema.safeParse({
      ...createOrderInput,
      shippingAddress: { ...createOrderInput.shippingAddress, country: "pk" },
    }).success,
    false,
  );
  assert.equal(
    CreateOrderInputSchema.safeParse({
      ...createOrderInput,
      expectedTotal: undefined,
    }).success,
    true,
  );
});

test("order and reservation quantity bounds and line limits", () => {
  for (const quantity of [0, 100, 1.5]) {
    assert.equal(
      CreateOrderInputSchema.safeParse({
        ...createOrderInput,
        items: [{ ...createOrderInput.items[0], quantity }],
      }).success,
      false,
    );
    assert.equal(
      ReservationRequestSchema.safeParse({
        ...reservationRequest,
        lines: [{ ...reservationRequest.lines[0], quantity }],
      }).success,
      false,
    );
  }
  assert.equal(
    CreateOrderInputSchema.safeParse({
      ...createOrderInput,
      items: Array(51).fill(createOrderInput.items[0]),
    }).success,
    false,
  );
  assert.equal(
    ReservationRequestSchema.safeParse({
      ...reservationRequest,
      lines: Array(51).fill(reservationRequest.lines[0]),
    }).success,
    false,
  );
});

test("status enums use the order and sub-order state vocabularies", () => {
  assert.deepEqual(OrderStatusSchema.options, [
    "awaiting_payment",
    "paid",
    "in_fulfilment",
    "fulfilled",
    "cancelled",
  ]);
  assert.deepEqual(SubOrderStatusSchema.options, [
    "awaiting_payment",
    "paid",
    "confirmed",
    "shipped",
    "delivered",
    "cancelled",
  ]);
  assert.deepEqual(RefundStatusSchema.options, ["none", "partial", "full"]);
});
