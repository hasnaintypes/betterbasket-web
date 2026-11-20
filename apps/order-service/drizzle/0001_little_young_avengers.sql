CREATE TABLE "sub_order_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub_order_id" uuid NOT NULL,
	"from_status" "sub_order_status" NOT NULL,
	"to_status" "sub_order_status" NOT NULL,
	"actor_id" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sub_order_status_history" ADD CONSTRAINT "sub_order_status_history_sub_order_id_sub_orders_id_fk" FOREIGN KEY ("sub_order_id") REFERENCES "sub_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sub_order_status_history_sub_order_created_idx" ON "sub_order_status_history" USING btree ("sub_order_id","created_at" DESC NULLS LAST);
