-- Run once as the database owner before service migrations. Provision LOGIN
-- credentials separately through the secret manager; no passwords live here.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'payment_migrator') THEN
    CREATE ROLE payment_migrator NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'payment_app') THEN
    CREATE ROLE payment_app NOLOGIN;
  END IF;
END $$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO payment_migrator;
GRANT USAGE ON SCHEMA public TO payment_app;

-- Drizzle's journal lives in its own schema. A clean database needs this
-- schema before the migrator connects; an existing journal needs DML grants.
CREATE SCHEMA IF NOT EXISTS drizzle;
GRANT USAGE, CREATE ON SCHEMA drizzle TO payment_migrator;
DO $$ BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    GRANT SELECT, INSERT ON drizzle.__drizzle_migrations TO payment_migrator;
  END IF;
END $$;
