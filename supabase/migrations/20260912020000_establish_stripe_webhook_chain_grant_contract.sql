-- Establishes an explicit privilege contract for the Stripe payment-webhook processing chain,
-- closing a gap first found in payment_webhook_events (see the now-superseded
-- 20260912010000_establish_payment_webhook_events_grant_contract.sql, folded into this file) and
-- then proven -- by advancing the same failing integration tests one permission-denied error at a
-- time -- to extend across eleven more tables in two domains that share the same webhook route:
--   rental domain (6 more): landlord_payment_accounts, rental_payments, rental_settlements,
--     rent_charges, rental_autopay_enrollments, ach_authorizations.
--   private-financing domain (4): private_financing_online_payments, private_financing_events,
--     private_financing_components, private_financing_account_terms_versions -- discovered
--     because src/app/api/rental/stripe-webhook/route.js unconditionally probes
--     private_financing_online_payments on every charge.succeeded/charge.updated/refund.updated/
--     pf_payment_*-prefixed event, REGARDLESS of whether the event turns out to belong to the
--     rental or private-financing domain, so a rental-only refund/settlement test failed on a
--     private-financing table it never otherwise touches.
--   plus one load-bearing dependency of a rental table's own pre-existing policy: rental_tenants
--     (authenticated: select only -- see its own section below).
--
-- Root cause (identical across all twelve tables): production migrations run as supabase_admin,
-- which carries this project's ALTER DEFAULT PRIVILEGES configuration -- an ambient default ACL
-- that auto-grants full table privileges (and EXECUTE) to anon/authenticated/service_role/postgres
-- on every newly created object. The local Supabase CLI stack runs migrations as plain postgres,
-- which has no such default ACL. Every one of these tables was created without a single explicit
-- GRANT statement, so production has always carried full, unintended privileges on all of them for
-- anon and authenticated -- invisible in practice only because every table has
-- relforcerowsecurity = true, so a role without BYPASSRLS (i.e. every role except service_role) is
-- denied at the row level even while holding the raw table grant. service_role's own ambient
-- grant, however, is genuinely broader (includes DELETE, TRUNCATE, REFERENCES, TRIGGER) than
-- anything production code actually uses on any of these tables.
--
-- Explicitly investigated and NOT granted here, each for a distinct, evidenced reason:
--   financial_events -- every production reader (src/app/api/rental/route.js, reports/route.js,
--     manual-financial-event/route.js, the Rentec/Simplifi import routes, FinancialWorkspace
--     QueryService.js) reads it via the AUTHENTICATED client; a repo-wide search for a
--     service_role reader/writer of this table found none outside this domain's own test file.
--     The table's own webhook-triggered write already succeeds today via
--     post_succeeded_rental_payment_to_financial_event() / the reversal trigger, both
--     SECURITY DEFINER set row_security = off, which bypass grants entirely as their owner. The
--     six integration-test assertions that appeared to need service_role SELECT here were a
--     test-only gap, fixed in this same change by rewriting those assertions to read via the
--     local Postgres administrator instead (see rentalPaymentChain.integration.test.js) -- not by
--     widening a production role's grant for a caller that does not exist.
--   rental_lease_tenants, rent_schedules -- both are read directly inside
--     request_rental_autopay_enrollment(), which has its own separate, pre-existing RLS defect
--     (documented in the rental_autopay_enrollments section below): a tenant-invoked SECURITY
--     INVOKER RPC that writes with owner_id = the tenant's landlord, which the only
--     insert/update-permitting policy on rental_autopay_enrollments can never satisfy for a mere
--     tenant. Granting these two tables' privileges alone would not make that RPC usable by a
--     tenant -- it would only move the failure one or two steps later, to the RLS check itself.
--     Deferred to a dedicated future PR that fixes the RLS defect together with whatever grants
--     that fix then requires.
--   ach_authorizations -- see its own section below (confirmed dead code).
--
-- This migration does not touch RLS. Every policy below is pre-existing and unchanged; grep
-- `pg_policies` after this migration and it will read identically to before. It does not touch
-- this project's ALTER DEFAULT PRIVILEGES configuration, which remains correct and in place for
-- every table outside this seven-table domain. It does not modify any existing row in any of the
-- seven tables -- every statement below is a privilege-only REVOKE/GRANT, and both are inherently
-- idempotent: revoking a privilege a role no longer holds, or granting one it already holds, is a
-- no-op, not an error. Re-running this entire file is safe and produces zero drift.
--
-- Per-table authorization model (independently derived, not a blanket policy) -- see the RLS
-- policies still in force on each table for the authoritative row-level rule; the grants below
-- only decide which roles may even attempt the operations those policies already gate:
--
-- payment_webhook_events -- zero RLS policies (deliberate: contains raw processor payload
--   metadata, never legitimately owner- or tenant-visible). No authenticated/anon access of any
--   kind. Sole legitimate access: service_role, via the shared stripe-webhook and
--   stripe-account-webhook routes (select for dedup, upsert, update -- never delete) and via the
--   four SECURITY INVOKER functions below (select / select-for-update / update only).
--   -> service_role: select, insert, update. Nobody else: nothing.
--
-- landlord_payment_accounts -- landlord_payment_accounts_owner_select (select, has_workspace_
--   access) is the only policy; there has never been an owner-facing insert/update/delete policy
--   -- writes are deliberately service-role-only, populated from verified Stripe Connect
--   responses (src/app/api/rental/stripe-account/route.js -- itself invoked by an authenticated
--   landlord, but performs every read and write through createRentalWebhookClient(), a
--   service_role client, application-scoped by owner_id -- never through the authenticated RLS
--   path; src/app/api/rental/stripe-account-webhook/route.js; src/application/rental/
--   executeAutopayAttempt.js reads it; settlement-reconciliation cron reads it).
--   -> authenticated: select (workspace-RLS gated). service_role: select, insert, update.
--
-- rental_payments -- rental_payments_owner_all (for all, has_workspace_access) and
--   rental_payments_tenant_select (select, rental_actor_has_lease_access) are both pre-existing
--   and unchanged. No authenticated-invoked code path ever directly UPDATEs a row in this table:
--   the only authenticated-facing writers are two SECURITY INVOKER RPCs that INSERT
--   (record_offline_rental_payment, approve_rentec_payment_import), both already EXECUTE-scoped
--   to authenticated only. service_role inserts and updates via the Stripe webhook chain
--   (process_stripe_rental_payment_event, process_stripe_rental_refund_event) and directly via
--   executeAutopayAttempt.js (insert on attempt creation, update on provider-id/failure
--   transitions).
--   -> authenticated: select, insert (no update -- no direct-write workflow exists; the owner_all
--      policy already covers this, this grant only adds the table-level privilege it requires).
--      service_role: select, insert, update.
--
-- rental_settlements -- rental_settlements_owner_all (for all, has_workspace_access) only; no
--   tenant policy (settlements are landlord/service-role information, deliberately not
--   tenant-visible). No authenticated code path writes to this table at all -- owners only ever
--   read it (src/app/api/rental/route.js, settlement-reconciliation cron's read-side). All writes
--   are service_role, via record_stripe_rental_settlement and mark_stripe_rental_settlements_
--   paid_out.
--   -> authenticated: select only. service_role: select, insert, update.
--
-- rent_charges -- rent_charges_owner_all (for all, has_workspace_access) and rent_charges_
--   tenant_select (select, rental_actor_has_lease_access) are both pre-existing and unchanged.
--   Multiple SECURITY INVOKER, authenticated-only RPCs directly insert or update this table:
--   generate_monthly_rent_charge (insert), void_rental_rent_charge (update),
--   record_offline_rental_payment (update paid_amount_cents/status),
--   approve_rentec_payment_import (update). service_role separately upserts via the
--   generate-charges cron (src/app/api/rental/cron/generate-charges/route.js) and reads/updates
--   via executeAutopayAttempt.js and the autopay-sweep cron. No delete workflow exists anywhere
--   -- voiding a charge is a status flag (rent_charges.status = 'void'), never a row deletion.
--   -> authenticated: select, insert, update. service_role: select, insert, update.
--
-- rental_autopay_enrollments -- rental_autopay_owner_all (for all, has_workspace_access) and
--   rental_autopay_tenant_read (select, tenant-membership exists-check) are both pre-existing and
--   unchanged. Two SECURITY INVOKER RPCs invoked by an authenticated tenant session
--   (request_rental_autopay_enrollment inserts, cancel_rental_autopay_enrollment updates) require
--   authenticated to hold table-level insert/update privilege for their own writes to even reach
--   RLS evaluation.
--
--   ** Observed, pre-existing, and explicitly OUT OF SCOPE for this grants-only migration: both
--   RPCs are SECURITY INVOKER and write with owner_id set to the TENANT'S LANDLORD (t.owner_id),
--   not the calling tenant's own auth.uid(). Under SECURITY INVOKER this INSERT/UPDATE is
--   evaluated against the CALLING tenant's own row-level privileges, and the only insert/update-
--   permitting policy (rental_autopay_owner_all) requires has_workspace_access(owner_id) --
--   true for the landlord or an active co-owner, false for a mere tenant. No tenant-write policy
--   exists on this table. This is a genuine RLS-policy-logic gap in the tenant autopay-enrollment
--   flow, orthogonal to the grant-parity problem this migration closes, and is not fixed here:
--   fixing it would mean adding a new permissive policy, which is exactly what this migration's
--   own governing rules forbid doing to make a workflow pass ("do not add permissive policies",
--   "preserve existing legitimate policies"). Whether that flow already fails identically in
--   production today, or production compensates some other way, is a separate investigation for
--   whoever owns the tenant autopay-enrollment feature; this migration only ensures that once
--   that gap is fixed by a policy change, the necessary table privilege is already there waiting
--   for it, and that today's owner-invoked autopay paths (which already satisfy has_workspace_
--   access) work correctly end to end.
--
--   service_role updates status via activate_rental_autopay_from_payment and directly via
--   executeAutopayAttempt.js (consecutive_failures/status transitions on payment failure). No
--   service_role insert workflow exists -- enrollment creation is authenticated-only.
--   -> authenticated: select, insert, update. service_role: select, update.
--
-- ach_authorizations -- ach_authorizations_owner_all (for all, has_workspace_access) and
--   ach_authorizations_tenant_select (select, rental_actor_has_lease_access) are both pre-existing
--   and unchanged, but confirmed dead: no RPC and no application route anywhere in this codebase
--   currently reads or writes this table (also independently noted in
--   20260821000000_add_stripe_provider_mode_isolation.sql when its provider_mode column was
--   added). Per the standing rule that authenticated receives only operations required by an
--   EXISTING user-facing workflow, no grant is made to any role here. When ACH mandate storage is
--   actually wired up, that feature's own migration must add the specific privileges its RPCs or
--   routes require -- granting ahead of a real workflow would be exactly the "unintended
--   privilege" this migration exists to eliminate elsewhere.
--   -> authenticated: nothing. service_role: nothing. (No legitimate direct client access today.)
--
-- No DELETE is granted to any role on any of these tables. No production or test-application
-- code path anywhere in this domain calls .delete() through the JS client; every migration test
-- below cleans up its own fixtures via the local PostgreSQL superuser (through the shared psql()
-- helper, i.e. `docker exec ... psql`, which bypasses table grants entirely) or via row-scoped
-- canary deletes issued the same way -- never by widening any role's production grant.

-- ---------------------------------------------------------------------------------------------
-- payment_webhook_events
-- ---------------------------------------------------------------------------------------------
revoke all privileges on payment_webhook_events from public;
revoke all privileges on payment_webhook_events from anon;
revoke all privileges on payment_webhook_events from authenticated;
revoke all privileges on payment_webhook_events from service_role;
grant select, insert, update on payment_webhook_events to service_role;

-- ---------------------------------------------------------------------------------------------
-- landlord_payment_accounts
-- ---------------------------------------------------------------------------------------------
revoke all privileges on landlord_payment_accounts from public;
revoke all privileges on landlord_payment_accounts from anon;
revoke all privileges on landlord_payment_accounts from authenticated;
revoke all privileges on landlord_payment_accounts from service_role;
grant select on landlord_payment_accounts to authenticated;
grant select, insert, update on landlord_payment_accounts to service_role;

-- ---------------------------------------------------------------------------------------------
-- rental_payments
-- ---------------------------------------------------------------------------------------------
revoke all privileges on rental_payments from public;
revoke all privileges on rental_payments from anon;
revoke all privileges on rental_payments from authenticated;
revoke all privileges on rental_payments from service_role;
grant select, insert on rental_payments to authenticated;
grant select, insert, update on rental_payments to service_role;

-- ---------------------------------------------------------------------------------------------
-- rental_settlements
-- ---------------------------------------------------------------------------------------------
revoke all privileges on rental_settlements from public;
revoke all privileges on rental_settlements from anon;
revoke all privileges on rental_settlements from authenticated;
revoke all privileges on rental_settlements from service_role;
grant select on rental_settlements to authenticated;
grant select, insert, update on rental_settlements to service_role;

-- ---------------------------------------------------------------------------------------------
-- rent_charges
-- ---------------------------------------------------------------------------------------------
revoke all privileges on rent_charges from public;
revoke all privileges on rent_charges from anon;
revoke all privileges on rent_charges from authenticated;
revoke all privileges on rent_charges from service_role;
grant select, insert, update on rent_charges to authenticated;
grant select, insert, update on rent_charges to service_role;

-- ---------------------------------------------------------------------------------------------
-- rental_autopay_enrollments
-- ---------------------------------------------------------------------------------------------
revoke all privileges on rental_autopay_enrollments from public;
revoke all privileges on rental_autopay_enrollments from anon;
revoke all privileges on rental_autopay_enrollments from authenticated;
revoke all privileges on rental_autopay_enrollments from service_role;
grant select, insert, update on rental_autopay_enrollments to authenticated;
grant select, update on rental_autopay_enrollments to service_role;

-- rental_tenants -- two independent, currently-reachable production justifications, not merely a
-- side effect of the autopay defect below:
--   (1) rental_autopay_tenant_read (on rental_autopay_enrollments, pre-existing, unchanged)
--       evaluates a raw `exists (select 1 from rental_tenants ...)` subquery directly in its USING
--       clause -- unlike every other tenant-facing policy in this domain, it is NOT wrapped in a
--       SECURITY DEFINER helper (rental_actor_has_lease_access, has_workspace_access), so Postgres
--       evaluates that subquery with the CALLING role's own privileges. Confirmed empirically:
--       without this grant, EVERY authenticated query against rental_autopay_enrollments --
--       including an owner's own, matched by the unrelated rental_autopay_owner_all policy --
--       fails with "permission denied for table rental_tenants", because Postgres must evaluate
--       every applicable USING clause for the role, and one erroring aborts the whole query
--       regardless of which policy would have allowed it.
--   (2) TenantPortalQueryService.load() (src/application/rental/TenantPortalQueryService.js:14),
--       invoked by the GET handler of src/app/api/rental/portal/route.js on every tenant portal
--       page load -- entirely independent of autopay -- does
--       `this.supabase.from("rental_tenants").select("*").eq("auth_user_id", authUserId)`,
--       matched by rental_tenants_self_select. Confirmed empirically: revoking this grant makes
--       that exact query fail with the identical "permission denied for table rental_tenants";
--       re-granting it restores success. This alone would justify the grant even setting (1) and
--       the autopay RLS defect aside entirely.
-- No other privilege on rental_tenants is granted here -- only what these two read paths need.
grant select on rental_tenants to authenticated;

-- ---------------------------------------------------------------------------------------------
-- ach_authorizations -- confirmed dead code; explicit zero-grant, not an oversight.
-- ---------------------------------------------------------------------------------------------
revoke all privileges on ach_authorizations from public;
revoke all privileges on ach_authorizations from anon;
revoke all privileges on ach_authorizations from authenticated;
revoke all privileges on ach_authorizations from service_role;

-- ---------------------------------------------------------------------------------------------
-- private_financing_online_payments -- read unconditionally by src/app/api/rental/stripe-webhook/
--   route.js's processPrivateFinancingPaymentEvent()/creditPrivateFinancingStripeFee()/
--   processPrivateFinancingRefund() helpers on every charge.succeeded, charge.updated,
--   refund.updated, or pf_payment_*-prefixed event -- regardless of whether the event turns out to
--   belong to this domain or to rental, since the route must check first. Also selected, inserted,
--   and updated directly by src/app/api/private-financing/portal/payment-session/route.js (the
--   real borrower payment-session creation flow), all via createRentalWebhookClient()
--   (service_role). Its own RLS policies (pre-existing, unchanged) already grant authenticated
--   select/insert/update for owner/borrower/stranger access; those are untouched here -- this
--   migration only adds service_role's own table-level privilege. Confirmed via chain-walk on a
--   fresh stack: granting service_role SELECT here alone still failed one step later (see
--   private_financing_events below); granting all four tables in this domain together is what
--   made the full payment/refund/fee-credit chain succeed end to end.
--   -> service_role: select, insert, update (no delete -- no delete workflow found anywhere).
revoke all privileges on private_financing_online_payments from service_role;
grant select, insert, update on private_financing_online_payments to service_role;

-- ---------------------------------------------------------------------------------------------
-- private_financing_events, private_financing_components, private_financing_account_terms_
--   versions -- read-only, read directly (never written) by the same three route.js helper
--   functions immediately after their private_financing_online_payments lookup succeeds, to build
--   the JS-side ledger projection passed into the SECURITY DEFINER RPCs
--   (complete_private_financing_stripe_payment, credit_private_financing_stripe_fee,
--   reverse_private_financing_stripe_payment) that perform the actual writes. Those RPCs are
--   SECURITY DEFINER set row_security = off, so service_role needs no INSERT/UPDATE privilege on
--   any of these three tables for the RPCs' own internal writes -- only SELECT, for the JS code's
--   own read-then-project step beforehand. authenticated already holds SELECT on all three from
--   20260830000700_grant_private_financing_authenticated_reads.sql (pre-existing, unchanged,
--   restated as a no-op revoke/grant below only to keep this file a complete, self-contained
--   statement of the whole chain's contract); only service_role's own missing grant is new.
-- ---------------------------------------------------------------------------------------------
grant select on private_financing_events to service_role;
grant select on private_financing_components to service_role;
grant select on private_financing_account_terms_versions to service_role;

-- ---------------------------------------------------------------------------------------------
-- Functions -- every function whose body touches any of the tables above. All of these
-- already carry correct, explicit EXECUTE grants from their own original migrations (create or
-- replace function never resets previously granted privileges), so nothing here changes live
-- behavior. Restated idempotently so this migration is a single, complete, self-contained
-- statement of the entire domain's privilege contract -- table and function -- rather than
-- depending on a reader also trusting that a dozen separate older migrations each got this right.
-- ---------------------------------------------------------------------------------------------

-- payment_webhook_events / rental_payments / rental_settlements -- Stripe webhook chain (service_role only)
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

revoke all on function activate_rental_autopay_from_payment(text, text, text, text, text) from public, anon, authenticated;
grant execute on function activate_rental_autopay_from_payment(text, text, text, text, text) to service_role;

-- rental_payments -- reversal trigger (fires as its owner; not directly callable by any role)
revoke all on function reconcile_rental_payment_reversal() from public, anon, authenticated;

-- rent_charges / rental_payments -- authenticated owner/tenant RPCs
revoke all on function generate_monthly_rent_charge(text, text, text) from public, anon;
grant execute on function generate_monthly_rent_charge(text, text, text) to authenticated;

revoke all on function void_rental_rent_charge(text, text, text) from public, anon;
grant execute on function void_rental_rent_charge(text, text, text) to authenticated;

revoke all on function record_offline_rental_payment(text, text, text, bigint, timestamptz, text, text) from public, anon;
grant execute on function record_offline_rental_payment(text, text, text, bigint, timestamptz, text, text) to authenticated;

revoke all on function approve_rentec_payment_import(
  text, text, text, text, bigint, date, text, text, text, text
) from public, anon;
grant execute on function approve_rentec_payment_import(
  text, text, text, text, bigint, date, text, text, text, text
) to authenticated;

revoke all on function commit_rentec_rental_import(text, jsonb, jsonb, jsonb) from public, anon;
grant execute on function commit_rentec_rental_import(text, jsonb, jsonb, jsonb) to authenticated;

revoke all on function queue_rental_balance_reminder(text, text, timestamptz, text, smallint) from public, anon;
grant execute on function queue_rental_balance_reminder(text, text, timestamptz, text, smallint) to authenticated;

-- rental_autopay_enrollments -- authenticated tenant RPCs (subject to the pre-existing,
-- out-of-scope RLS-policy gap documented above; the EXECUTE grant itself is correct regardless)
revoke all on function request_rental_autopay_enrollment(text, text, smallint, smallint, text) from public, anon;
grant execute on function request_rental_autopay_enrollment(text, text, smallint, smallint, text) to authenticated;

revoke all on function cancel_rental_autopay_enrollment(text, text) from public, anon;
grant execute on function cancel_rental_autopay_enrollment(text, text) to authenticated;

-- private_financing_online_payments / private_financing_events / private_financing_components /
-- private_financing_account_terms_versions -- the four SECURITY DEFINER RPCs that mutate this
-- domain's ledger, already correctly EXECUTE-scoped to service_role only in
-- 20260831000200_add_private_financing_stripe_payments.sql -- restated idempotently for the same
-- single-source-of-truth reason as the rest of this file.
revoke all on function complete_private_financing_stripe_payment(
  text, text, bigint, date, jsonb, jsonb, bigint, jsonb, text
) from public, anon, authenticated;
grant execute on function complete_private_financing_stripe_payment(
  text, text, bigint, date, jsonb, jsonb, bigint, jsonb, text
) to service_role;

revoke all on function update_private_financing_stripe_payment_status(
  text, text, text, text, text
) from public, anon, authenticated;
grant execute on function update_private_financing_stripe_payment_status(
  text, text, text, text, text
) to service_role;

revoke all on function credit_private_financing_stripe_fee(
  text, text, bigint, bigint, date, text, bigint
) from public, anon, authenticated;
grant execute on function credit_private_financing_stripe_fee(
  text, text, bigint, bigint, date, text, bigint
) to service_role;

revoke all on function reverse_private_financing_stripe_payment(
  text, text, text, bigint, date, jsonb, jsonb, bigint, jsonb
) from public, anon, authenticated;
grant execute on function reverse_private_financing_stripe_payment(
  text, text, text, bigint, date, jsonb, jsonb, bigint, jsonb
) to service_role;
