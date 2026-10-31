import test from "node:test";
import assert from "node:assert/strict";
import { breakingChanges, compareSnapshots } from "./diff-schemas.mjs";

const orderItem = {
  type: "object",
  properties: { productId: { type: "string" }, quantity: { type: "integer" } },
  required: ["productId", "quantity"],
};

test("removing quantity from OrderItemSchema is breaking", () => {
  const changed = { ...orderItem, properties: { productId: { type: "string" } }, required: ["productId"] };
  assert.match(breakingChanges(orderItem, changed).join("\n"), /quantity: property removed/);
});

test("adding an optional field is compatible", () => {
  const changed = { ...orderItem, properties: { ...orderItem.properties, note: { type: "string" } } };
  assert.deepEqual(breakingChanges(orderItem, changed), []);
});

test("making an optional field required is breaking", () => {
  const before = { ...orderItem, properties: { ...orderItem.properties, note: { type: "string" } } };
  assert.match(breakingChanges(before, { ...before, required: [...before.required, "note"] }).join("\n"), /note: became required/);
});

test("changing a property type is breaking", () => {
  const changed = { ...orderItem, properties: { ...orderItem.properties, quantity: { type: "string" } } };
  assert.match(breakingChanges(orderItem, changed).join("\n"), /quantity: type changed/);
});

test("tightening a numeric constraint is breaking", () => {
  const changed = { ...orderItem, properties: { ...orderItem.properties, quantity: { type: "integer", exclusiveMinimum: 0 } } };
  assert.match(breakingChanges(orderItem, changed).join("\n"), /exclusiveMinimum changed/);
});

test("enum widening passes and removing an enum value fails", () => {
  assert.deepEqual(breakingChanges({ enum: ["a", "b"] }, { enum: ["a", "b", "c"] }), []);
  assert.match(breakingChanges({ enum: ["a", "b"] }, { enum: ["a"] }).join("\n"), /enum value removed/);
});

test("an exported schema cannot be removed; a new version can be added", () => {
  const before = new Map([["OrderItemSchema.json", orderItem]]);
  assert.match(compareSnapshots(before, new Map()).join("\n"), /exported schema removed/);
  assert.deepEqual(compareSnapshots(before, new Map([...before, ["OrderItemV2Schema.json", orderItem]])), []);
});
