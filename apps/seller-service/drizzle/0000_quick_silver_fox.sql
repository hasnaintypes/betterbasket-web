DO $$ BEGIN
  CREATE TYPE seller_member_role AS ENUM ('owner', 'admin', 'member');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE seller_status AS ENUM ('pending', 'stripe_pending', 'active', 'suspended');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
ALTER TYPE seller_status ADD VALUE IF NOT EXISTS 'under_review';--> statement-breakpoint
ALTER TYPE seller_status ADD VALUE IF NOT EXISTS 'closed';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS sellers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  organization_id text NOT NULL UNIQUE,
  store_name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  logo_url text,
  stripe_account_id text,
  country text,
  support_email text,
  status seller_status DEFAULT 'pending' NOT NULL,
  approved_by text,
  approved_at timestamptz,
  suspended_reason text,
  version integer DEFAULT 0 NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS country text;--> statement-breakpoint
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS support_email text;--> statement-breakpoint
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS approved_by text;--> statement-breakpoint
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS approved_at timestamptz;--> statement-breakpoint
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS suspended_reason text;--> statement-breakpoint
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS version integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS outbox (
  id uuid PRIMARY KEY NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  type text NOT NULL,
  version integer NOT NULL,
  payload jsonb NOT NULL,
  headers jsonb NOT NULL,
  created_at timestamptz DEFAULT clock_timestamp() NOT NULL,
  published_at timestamptz,
  attempts integer DEFAULT 0 NOT NULL,
  next_attempt_at timestamptz DEFAULT now() NOT NULL,
  quarantined_at timestamptz
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS processed_events (
  consumer text NOT NULL,
  event_id uuid NOT NULL,
  processed_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT processed_events_consumer_event_id_pk PRIMARY KEY (consumer, event_id)
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS seller_members (
  seller_id uuid NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  role seller_member_role NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT seller_members_seller_id_user_id_pk PRIMARY KEY (seller_id, user_id)
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS seller_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  seller_id uuid NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  from_status seller_status NOT NULL,
  to_status seller_status NOT NULL,
  actor_id text,
  reason text,
  at timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS outbox_due_idx ON outbox (published_at, quarantined_at, next_attempt_at);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS outbox_aggregate_order_idx ON outbox (aggregate_type, aggregate_id, created_at, id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS processed_events_processed_at_idx ON processed_events (processed_at);--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_approved_seller_slug_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.approved_at IS NOT NULL OR OLD.status IN ('active', 'suspended', 'closed'))
     AND NEW.slug IS DISTINCT FROM OLD.slug THEN
    RAISE EXCEPTION 'approved seller slug is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS sellers_slug_immutable_after_approval ON sellers;--> statement-breakpoint
CREATE TRIGGER sellers_slug_immutable_after_approval
  BEFORE UPDATE OF slug ON sellers
  FOR EACH ROW EXECUTE FUNCTION prevent_approved_seller_slug_change();
