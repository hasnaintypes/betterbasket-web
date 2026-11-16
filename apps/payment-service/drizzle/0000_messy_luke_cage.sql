CREATE TYPE "stripe_event_scope" AS ENUM('account', 'connect');--> statement-breakpoint
CREATE TYPE "stripe_event_status" AS ENUM('received', 'processed', 'failed');--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"type" text NOT NULL,
	"version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"headers" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"quarantined_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "processed_events" (
	"consumer" text NOT NULL,
	"event_id" uuid NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processed_events_consumer_event_id_pk" PRIMARY KEY("consumer","event_id")
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"scope" "stripe_event_scope" NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"status" "stripe_event_status" DEFAULT 'received' NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "outbox_due_idx" ON "outbox" USING btree ("published_at","quarantined_at","next_attempt_at");--> statement-breakpoint
CREATE INDEX "outbox_aggregate_order_idx" ON "outbox" USING btree ("aggregate_type","aggregate_id","created_at","id");--> statement-breakpoint
CREATE INDEX "processed_events_processed_at_idx" ON "processed_events" USING btree ("processed_at");--> statement-breakpoint
CREATE INDEX "stripe_events_retry_idx" ON "stripe_events" USING btree ("status","received_at");--> statement-breakpoint
CREATE INDEX "stripe_events_retention_idx" ON "stripe_events" USING btree ("processed_at");
