CREATE TYPE "order_status" AS ENUM('awaiting_payment', 'paid', 'in_fulfilment', 'fulfilled', 'cancelled');--> statement-breakpoint
CREATE TYPE "order_refund_status" AS ENUM('none', 'partial', 'full');--> statement-breakpoint
CREATE TYPE "sub_order_status" AS ENUM('awaiting_payment', 'paid', 'confirmed', 'shipped', 'delivered', 'cancelled');--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub_order_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"product_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"sku" text NOT NULL,
	"title_snapshot" text NOT NULL,
	"unit_price" integer NOT NULL,
	"quantity" integer NOT NULL,
	"line_total" integer NOT NULL,
	CONSTRAINT "order_items_amounts_valid" CHECK ("order_items"."unit_price" >= 0 AND "order_items"."line_total" >= 0 AND "order_items"."quantity" > 0),
	CONSTRAINT "order_items_line_total_matches" CHECK ("order_items"."line_total" = "order_items"."unit_price" * "order_items"."quantity")
);
--> statement-breakpoint
CREATE TABLE "order_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"from_status" "order_status" NOT NULL,
	"to_status" "order_status" NOT NULL,
	"actor_id" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"buyer_id" text NOT NULL,
	"status" "order_status" DEFAULT 'awaiting_payment' NOT NULL,
	"refund_status" "order_refund_status" DEFAULT 'none' NOT NULL,
	"currency" char(3) NOT NULL,
	"subtotal" integer NOT NULL,
	"shipping_total" integer NOT NULL,
	"total" integer NOT NULL,
	"shipping_address" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_amounts_nonnegative" CHECK ("orders"."subtotal" >= 0 AND "orders"."shipping_total" >= 0 AND "orders"."total" >= 0),
	CONSTRAINT "orders_total_matches_parts" CHECK ("orders"."total" = "orders"."subtotal" + "orders"."shipping_total"),
	CONSTRAINT "orders_currency_uppercase" CHECK ("orders"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "orders_version_nonnegative" CHECK ("orders"."version" >= 0)
);
--> statement-breakpoint
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
CREATE TABLE "sub_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"status" "sub_order_status" DEFAULT 'awaiting_payment' NOT NULL,
	"subtotal" integer NOT NULL,
	"shipping" integer NOT NULL,
	"total" integer NOT NULL,
	"commission_bps" integer NOT NULL,
	"commission_amount" integer NOT NULL,
	"seller_net" integer NOT NULL,
	"carrier" text,
	"tracking_number" text,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sub_orders_id_seller_unique" UNIQUE("id","seller_id"),
	CONSTRAINT "sub_orders_order_seller_unique" UNIQUE("order_id","seller_id"),
	CONSTRAINT "sub_orders_amounts_nonnegative" CHECK ("sub_orders"."subtotal" >= 0 AND "sub_orders"."shipping" >= 0 AND "sub_orders"."total" >= 0 AND "sub_orders"."commission_amount" >= 0 AND "sub_orders"."seller_net" >= 0),
	CONSTRAINT "sub_orders_total_matches_parts" CHECK ("sub_orders"."total" = "sub_orders"."subtotal" + "sub_orders"."shipping"),
	CONSTRAINT "sub_orders_allocation_balanced" CHECK ("sub_orders"."commission_amount" + "sub_orders"."seller_net" = "sub_orders"."total"),
	CONSTRAINT "sub_orders_commission_bps_range" CHECK ("sub_orders"."commission_bps" BETWEEN 0 AND 10000),
	CONSTRAINT "sub_orders_version_nonnegative" CHECK ("sub_orders"."version" >= 0)
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_sub_order_id_seller_id_sub_orders_id_seller_id_fk" FOREIGN KEY ("sub_order_id","seller_id") REFERENCES "sub_orders"("id","seller_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_orders" ADD CONSTRAINT "sub_orders_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_items_sub_order_idx" ON "order_items" USING btree ("sub_order_id");--> statement-breakpoint
CREATE INDEX "order_status_history_order_created_idx" ON "order_status_history" USING btree ("order_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "orders_buyer_created_idx" ON "orders" USING btree ("buyer_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "outbox_due_idx" ON "outbox" USING btree ("published_at","quarantined_at","next_attempt_at");--> statement-breakpoint
CREATE INDEX "outbox_aggregate_order_idx" ON "outbox" USING btree ("aggregate_type","aggregate_id","created_at","id");--> statement-breakpoint
CREATE INDEX "processed_events_processed_at_idx" ON "processed_events" USING btree ("processed_at");--> statement-breakpoint
CREATE INDEX "sub_orders_seller_status_created_idx" ON "sub_orders" USING btree ("seller_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sub_orders_order_idx" ON "sub_orders" USING btree ("order_id");
