import test from "node:test";
import assert from "node:assert/strict";
import { EventSchemaByTopic, Topics } from "../dist/index.js";
import { payloads } from "../fixtures/events.mjs";

test("every topic has one valid fixture and schema", () => {
  const topics = Object.values(Topics).sort();
  assert.deepEqual(Object.keys(EventSchemaByTopic).sort(), topics);
  assert.deepEqual(Object.keys(payloads).sort(), topics);
  for (const topic of topics) {
    const [type, version] = topic.split(/\.v(?=[0-9]+$)/);
    const fixture = {
      id: "00000000-0000-4000-8000-000000000001",
      type,
      version: Number(version),
      occurredAt: "2026-01-01T00:00:00Z",
      producer: "fixture-service",
      aggregateType: type.split(".")[0],
      aggregateId: "aggregate-1",
      correlationId: "00000000-0000-4000-8000-000000000002",
      causationId: "00000000-0000-4000-8000-000000000003",
      payload: payloads[topic],
    };
    const schema = EventSchemaByTopic[topic];
    assert.equal(schema.safeParse(fixture).success, true, topic);
    assert.equal(
      schema.safeParse({ ...fixture, payload: {} }).success,
      false,
      `${topic} required payload`,
    );
    assert.equal(
      schema.safeParse({ ...fixture, aggregateId: undefined }).success,
      false,
      `${topic} required envelope`,
    );
    assert.equal(schema.safeParse({ ...fixture, version: 99 }).success, false, `${topic} version`);
    if (topic === Topics.SellerStatusChanged) {
      assert.equal(
        schema.safeParse({ ...fixture, payload: { ...fixture.payload, to: "unknown" } }).success,
        false,
      );
    }
    if (topic === Topics.StripeAccountUpdated) {
      assert.equal(
        schema.safeParse({
          ...fixture,
          payload: { ...fixture.payload, requirementsDue: Array(101).fill("field") },
        }).success,
        false,
      );
    }
  }
});
