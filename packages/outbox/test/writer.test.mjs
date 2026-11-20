import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { OutboxWriter } from "../dist/index.js";

function event() {
  return {
    id: randomUUID(),
    type: "user.banned",
    version: 1,
    occurredAt: new Date(),
    producer: "test",
    aggregateType: "user",
    aggregateId: "user-1",
    correlationId: randomUUID(),
    causationId: randomUUID(),
    payload: { userId: "user-1", bannedAt: new Date(), reason: "test" },
  };
}

test("writer validates and caps events before touching the transaction", async () => {
  let inserts = 0;
  const tx = {
    execute: async () => {
      inserts += 1;
    },
  };
  await OutboxWriter.add(tx, event());
  assert.equal(inserts, 1);
  await assert.rejects(OutboxWriter.add(tx, { ...event(), payload: {} }));
  await assert.rejects(OutboxWriter.add(tx, { ...event(), version: 99 }));
  await assert.rejects(
    OutboxWriter.add(tx, {
      ...event(),
      payload: { userId: "user-1", bannedAt: new Date(), reason: "x".repeat(300_000) },
    }),
  );
  assert.equal(inserts, 1);
});
