-- The runtime role may not exist in a disposable migration database.
-- Production must create it before applying this migration.
REVOKE ALL ON TABLE "audit_log" FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bb_auth_app') THEN
    REVOKE ALL ON TABLE "audit_log" FROM bb_auth_app;
    GRANT SELECT, INSERT ON TABLE "audit_log" TO bb_auth_app;
  END IF;
END $$;
