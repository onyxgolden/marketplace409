-- Establishes an explicit privilege contract for payment_webhook_events, closing a gap found
-- while diagnosing why rentalPaymentChain.integration.test.js and stripePaymentChain.integration.
-- test.js fail on a genuinely fresh local Supabase stack: the table (created in
-- 20260812000500_create_rental_payments.sql, 2026-08-12) has never had an explicit GRANT
-- statement in any migration in this repository's history. It has always relied entirely on
-- ambient default privileges.
--
-- Verified live against production before this migration: anon, authenticated, AND service_role
-- all hold DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE -- full privileges,
-- via this project's ALTER DEFAULT PRIVILEGES configuration (confirmed via pg_default_acl,
-- matching the exact mechanism RV-A already documented for the reservation domain). This has
-- been harmless only because the table has relforcerowsecurity = true and zero RLS policies,
-- so every role except service_role (which bypasses RLS) is denied regardless of the grant.
-- service_role's own full grant, however, is genuinely broader than anything production code
-- actually uses.
--
-- Every production reader/writer of this table was traced before writing this migration:
--   * src/app/api/rental/stripe-webhook/route.js (rental + private-financing shared route) --
--     select (dedup lookup), upsert (insert-or-update), update (status transitions) -- via
--     createRentalWebhookClient(), a service_role client. Never delete.
--   * src/app/api/rental/stripe-account-webhook/route.js -- the connected-account webhook --
--     the identical select/upsert/update pattern, same service_role client. Never delete.
--   * process_stripe_rental_payment_event, process_stripe_rental_refund_event,
--     record_stripe_rental_settlement, mark_stripe_rental_settlements_paid_out -- the four
--     SECURITY INVOKER functions whose body references this table (confirmed authoritatively
--     against live production by matching pg_proc.prosrc, not by reading migration files) --
--     select / select ... for update / update only. Never insert or delete.
--   * src/app/api/stripe/financial-connections/webhook/route.js and
--     src/domains/private-financing/ledgerIntegrity.js only mention this table in comments;
--     neither touches it.
--   * Test cleanup (both integration test files' afterAll) deletes fixture rows via the shared
--     psql() helper, i.e. as the local Postgres superuser through `docker exec ... psql`, which
--     bypasses table grants entirely -- never through the JS service_role client. No test ever
--     calls .delete() on this table via the JS client either. There is no real production
--     deletion path for this table at all.
--
-- Conclusion: the minimum service_role table privilege is SELECT, INSERT, UPDATE. DELETE is not
-- required by any production code path or any JS-client test path, so it is not granted here,
-- per the standing rule that test convenience is not a reason to widen a production grant --
-- fixture cleanup already works, and continues to work, through the local database
-- administrator, not through any application-level privilege.
--
-- This migration only touches payment_webhook_events and the four functions above. It does not
-- touch any other payment table, any reservation table, or this project's project-wide
-- ALTER DEFAULT PRIVILEGES configuration (which remains in place for every other table that
-- still implicitly and correctly relies on it) -- narrowing that broader default is a separate,
-- much larger decision outside this slice's scope. It does not modify RLS (already forced, still
-- forced, still zero policies -- no user-facing policy is added) and it does not modify any
-- existing webhook-event row: every statement below is a privilege-only REVOKE/GRANT, and both
-- are inherently idempotent -- revoking a privilege a role no longer holds, or granting one it
-- already holds, is a no-op, not an error.

-- Table: explicit, minimal contract. Revoking all first (rather than naming individual
-- privileges to strip) guarantees no privilege this table's ambient default ever granted --
-- including ones not enumerated above -- survives by omission.
revoke all privileges on payment_webhook_events from public;
revoke all privileges on payment_webhook_events from anon;
revoke all privileges on payment_webhook_events from authenticated;
revoke all privileges on payment_webhook_events from service_role;
grant select, insert, update on payment_webhook_events to service_role;

-- Functions: already correctly locked down in production (confirmed live, not merely read from
-- migration text: anon/public/authenticated EXECUTE = false, service_role EXECUTE = true, for
-- all four, before this migration ever runs). Restated explicitly and idempotently anyway, so
-- this migration is a complete, self-contained statement of payment_webhook_events' entire
-- privilege contract -- table and every function that touches it -- in one place, rather than
-- depending on a reader also trusting that four separate older migrations got this right.
revoke all on function process_stripe_rental_payment_event(
  text, text, text, text, text, text, text, timestamptz, text
) from public, anon, authenticated;
grant execute on function process_stripe_rental_payment_event(
  text, text, text, text, text, text, text, timestamptz, text
) to service_role;

revoke all on function process_stripe_rental_refund_event(
  text, text, text, bigint, timestamptz, text
) from public, anon, authenticated;
grant execute on function process_stripe_rental_refund_event(
  text, text, text, bigint, timestamptz, text
) to service_role;

revoke all on function record_stripe_rental_settlement(
  text, text, text, text, bigint, bigint, bigint, text, text, timestamptz, text
) from public, anon, authenticated;
grant execute on function record_stripe_rental_settlement(
  text, text, text, text, bigint, bigint, bigint, text, text, timestamptz, text
) to service_role;

revoke all on function mark_stripe_rental_settlements_paid_out(
  text, text, text, text[], timestamptz, text
) from public, anon, authenticated;
grant execute on function mark_stripe_rental_settlements_paid_out(
  text, text, text, text[], timestamptz, text
) to service_role;
