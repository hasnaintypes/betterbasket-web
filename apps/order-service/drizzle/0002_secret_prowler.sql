CREATE TABLE "idempotency_keys" (
	"scope" text NOT NULL,
	"key" varchar(255) NOT NULL,
	"request_hash" text NOT NULL,
	"status" integer,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"in_progress_until" timestamp with time zone,
	"owner_id" uuid,
	CONSTRAINT "idempotency_keys_scope_key_pk" PRIMARY KEY("scope","key"),
	CONSTRAINT "idempotency_keys_hash_sha256" CHECK ("idempotency_keys"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "idempotency_keys_status_range" CHECK ("idempotency_keys"."status" IS NULL OR "idempotency_keys"."status" BETWEEN 100 AND 599),
	CONSTRAINT "idempotency_keys_response_pair" CHECK (("idempotency_keys"."status" IS NULL AND "idempotency_keys"."response" IS NULL) OR ("idempotency_keys"."status" IS NOT NULL AND "idempotency_keys"."response" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys" USING btree ("expires_at");