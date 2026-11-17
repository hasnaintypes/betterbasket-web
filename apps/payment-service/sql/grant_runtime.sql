-- Run as the database owner after each migration. The app role has no DDL.
GRANT USAGE ON TYPE
  public.payment_status,
  public.ledger_entry_type,
  public.transfer_status,
  public.payment_refund_status,
  public.dispute_status,
  public.reconciliation_exception_status,
  public.stripe_event_scope,
  public.stripe_event_status
TO payment_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.payments,
  public.transfers,
  public.refunds,
  public.disputes,
  public.reconciliation_exceptions,
  public.idempotency_keys,
  public.stripe_events,
  public.outbox,
  public.processed_events
TO payment_app;

-- Ledger corrections must be compensating inserts, never row edits.
REVOKE ALL ON public.ledger_entries FROM PUBLIC;
REVOKE ALL ON public.ledger_entries FROM payment_app;
GRANT SELECT, INSERT ON public.ledger_entries TO payment_app;
