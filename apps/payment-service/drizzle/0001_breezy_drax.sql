-- Role DDL is separate because the migrator has no CREATEROLE: run
-- sql/bootstrap_roles.sql as owner before migration and sql/grant_runtime.sql after.
DROP TABLE IF EXISTS "payout_ledger";--> statement-breakpoint
DROP TABLE IF EXISTS "payments";--> statement-breakpoint
DROP TYPE IF EXISTS "payment_status";--> statement-breakpoint
CREATE TYPE "dispute_status" AS ENUM('needs_response', 'under_review', 'won', 'lost', 'closed');--> statement-breakpoint
CREATE TYPE "ledger_entry_type" AS ENUM('charge', 'seller_allocation', 'commission', 'processing_fee', 'transfer', 'refund', 'transfer_reversal', 'refund_clearing', 'dispute_debit', 'dispute_fee', 'dispute_credit', 'adjustment', 'platform_receivable');--> statement-breakpoint
CREATE TYPE "payment_status" AS ENUM('requires_payment', 'processing', 'succeeded', 'failed', 'refunded');--> statement-breakpoint
CREATE TYPE "reconciliation_exception_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TYPE "payment_refund_status" AS ENUM('pending', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "transfer_status" AS ENUM('pending', 'held', 'processing', 'succeeded', 'failed', 'reversed');--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"stripe_dispute_id" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" char(3) NOT NULL,
	"status" "dispute_status" NOT NULL,
	"reason" text,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disputes_stripe_dispute_id_unique" UNIQUE("stripe_dispute_id"),
	CONSTRAINT "disputes_amount_positive" CHECK ("disputes"."amount" > 0),
	CONSTRAINT "disputes_currency_uppercase" CHECK ("disputes"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
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
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid,
	"order_id" uuid,
	"sub_order_id" uuid,
	"seller_id" uuid,
	"entry_type" "ledger_entry_type" NOT NULL,
	"debit_account" text NOT NULL,
	"credit_account" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" char(3) NOT NULL,
	"provider_object_type" text NOT NULL,
	"provider_object_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "ledger_entries_amount_positive" CHECK ("ledger_entries"."amount" > 0),
	CONSTRAINT "ledger_entries_currency_uppercase" CHECK ("ledger_entries"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "ledger_entries_distinct_accounts" CHECK ("ledger_entries"."debit_account" <> "ledger_entries"."credit_account"),
	CONSTRAINT "ledger_entries_accounts_nonempty" CHECK (length(trim("ledger_entries"."debit_account")) > 0 AND length(trim("ledger_entries"."credit_account")) > 0),
	CONSTRAINT "ledger_entries_provider_nonempty" CHECK (length(trim("ledger_entries"."provider_object_type")) > 0 AND length(trim("ledger_entries"."provider_object_id")) > 0)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"stripe_payment_intent_id" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" char(3) NOT NULL,
	"status" "payment_status" DEFAULT 'requires_payment' NOT NULL,
	"charge_id" text,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "payments_stripe_payment_intent_id_unique" UNIQUE("stripe_payment_intent_id"),
	CONSTRAINT "payments_charge_id_unique" UNIQUE("charge_id"),
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount" > 0),
	CONSTRAINT "payments_currency_uppercase" CHECK ("payments"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "payments_version_nonnegative" CHECK ("payments"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reconciliation_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid,
	"kind" text NOT NULL,
	"provider_object_type" text NOT NULL,
	"provider_object_id" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "reconciliation_exception_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "reconciliation_exceptions_provider_kind_unique" UNIQUE("provider_object_type","provider_object_id","kind")
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"sub_order_id" uuid,
	"amount" integer NOT NULL,
	"currency" char(3) NOT NULL,
	"status" "payment_refund_status" DEFAULT 'pending' NOT NULL,
	"reason_code" text NOT NULL,
	"requested_by" text NOT NULL,
	"stripe_refund_id" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_stripe_refund_id_unique" UNIQUE("stripe_refund_id"),
	CONSTRAINT "refunds_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "refunds_amount_positive" CHECK ("refunds"."amount" > 0),
	CONSTRAINT "refunds_currency_uppercase" CHECK ("refunds"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub_order_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"stripe_account_id" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" char(3) NOT NULL,
	"status" "transfer_status" DEFAULT 'pending' NOT NULL,
	"release_at" timestamp with time zone,
	"stripe_transfer_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfers_sub_order_id_unique" UNIQUE("sub_order_id"),
	CONSTRAINT "transfers_stripe_transfer_id_unique" UNIQUE("stripe_transfer_id"),
	CONSTRAINT "transfers_amount_positive" CHECK ("transfers"."amount" > 0),
	CONSTRAINT "transfers_currency_uppercase" CHECK ("transfers"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "transfers_attempts_nonnegative" CHECK ("transfers"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_exceptions" ADD CONSTRAINT "reconciliation_exceptions_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "disputes_payment_status_idx" ON "disputes" USING btree ("payment_id","status");--> statement-breakpoint
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "ledger_entries_payment_created_idx" ON "ledger_entries" USING btree ("payment_id","created_at");--> statement-breakpoint
CREATE INDEX "ledger_entries_sub_order_created_idx" ON "ledger_entries" USING btree ("sub_order_id","created_at");--> statement-breakpoint
CREATE INDEX "ledger_entries_provider_idx" ON "ledger_entries" USING btree ("provider_object_type","provider_object_id");--> statement-breakpoint
CREATE INDEX "payments_status_created_idx" ON "payments" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "reconciliation_exceptions_status_created_idx" ON "reconciliation_exceptions" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "refunds_order_created_idx" ON "refunds" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "transfers_seller_status_idx" ON "transfers" USING btree ("seller_id","status");--> statement-breakpoint
CREATE INDEX "transfers_release_idx" ON "transfers" USING btree ("status","release_at");
