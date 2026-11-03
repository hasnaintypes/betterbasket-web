import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  new URL("../drizzle/0000_demonic_pet_avengers.sql", import.meta.url),
  "utf8",
);

test("migration creates the Better Auth and project tables", () => {
  for (const name of [
    "user",
    "session",
    "account",
    "verification",
    "organization",
    "member",
    "invitation",
    "jwks",
    "audit_log",
    "outbox",
    "processed_events",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE "${name}"`));
  }
});

test("migration enforces identity and membership uniqueness", () => {
  assert.match(migration, /CONSTRAINT "user_email_unique" UNIQUE\("email"\)/);
  assert.match(migration, /CONSTRAINT "session_token_unique" UNIQUE\("token"\)/);
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "member_organization_user_unique" ON "member" USING btree \("organization_id","user_id"\)/,
  );
  assert.match(migration, /PRIMARY KEY\("consumer","event_id"\)/);
});

test("audit log stores a hash instead of a raw IP and timestamps carry a time zone", () => {
  const auditTable = migration.match(/CREATE TABLE "audit_log" \(([\s\S]*?)\);/)?.[1];
  assert.ok(auditTable);
  assert.match(auditTable, /"ip_hash" text/);
  assert.doesNotMatch(auditTable, /"ip" text|"ip_address" text/);
  assert.match(auditTable, /"at" timestamp with time zone/);
});
