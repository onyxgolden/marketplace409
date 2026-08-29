-- SF-1 Checkpoint D (REVISED) -- proposed Private Financing schema and RLS, WRITTEN BUT NOT APPLIED.
-- Nothing in this file has been run against any database (local or Production); it remains a proposal
-- for review. This revision responds to specific owner feedback on the first draft -- every section
-- below that changed is marked "REVISED" with the reason.
--
-- ============================================================================================
-- STATIC TESTS ARE NOT EXECUTION PROOF (owner requirement 7, this revision)
-- ============================================================================================
-- Every *.migration.test.js file paired with this migration validates TEXT STRUCTURE ONLY --
-- readFileSync + string matching against this file's own source. They prove the SQL says what it
-- claims to say; they CANNOT prove it parses, that functions compile, that constraints/policies/grants
-- take effect as intended, or that RLS actually behaves correctly for owner/co-owner/unrelated-user/
-- borrower/unrelated-borrower/anonymous callers. That requires a real PostgreSQL instance. Before this
-- migration is approved for merge or application, run it against a disposable local Supabase Postgres:
--
--     supabase db reset
--
-- Run from the repository root with the Supabase CLI installed and Docker running. This recreates the
-- LOCAL disposable Supabase Postgres container from scratch and applies every migration in
-- supabase/migrations/ in order (including this file) with fail-fast behavior equivalent to
-- ON_ERROR_STOP=on -- a failing statement aborts the reset immediately, and nothing is applied to any
-- remote or Production project (the local CLI stack is a separate, throwaway Docker Postgres instance;
-- it has no network path to Production credentials unless explicitly configured). After a successful
-- reset, verify functions compile (`\df private_financing_*` / `\df append_private_financing_event` in
-- `supabase db psql`... wait, wrong tool name, use plain `psql "$(supabase status -o json | jq -r
-- '.DB_URL')"` to connect), inspect \d+ on each table for constraints/policies, and exercise real
-- inserts/selects as at least: an owner, a co-owner, an unrelated authenticated user, a claimed
-- borrower, an unrelated borrower, and an anonymous (unauthenticated) request -- then either
-- `supabase db reset` again (destroys and rebuilds) or `supabase stop` to tear the local stack down.
-- This has NOT been done in this sandbox (no local PostgreSQL/Docker is available here); it remains a
-- required, outstanding step before this migration is ever approved to apply anywhere.
--
-- ============================================================================================
-- REVISION 1 -- BORROWER IDENTITY SEPARATED FROM ACCOUNT MEMBERSHIP
-- ============================================================================================
-- The first draft merged identity and membership into one private_financing_borrowers row, on the
-- reasoning that South Main only needed one borrower. That reasoning was wrong: the supplied South Main
-- agreement names TWO borrowers, and the product must support a borrower on multiple financing accounts
-- and multiple borrowers (with distinct roles) on one account -- neither of which a merged row can
-- express without duplicating identity data per account. This revision splits it:
--   private_financing_borrowers        -- identity/profile (email, name, phone, auth_user_id claim).
--   private_financing_account_borrowers -- membership: which account, what role, what status, when
--                                           invited/activated/revoked.
-- One identity row can now have many membership rows (multiple accounts under the same seller); one
-- account can now have many membership rows pointing at different identities (multiple borrowers,
-- distinguished by role). PII is kept minimal on purpose: email, full_name, phone only -- no SSN, no
-- birth date, no identity-document fields anywhere in this schema.
--
-- South Main is modeled with TWO private_financing_account_borrowers rows (role 'primary_borrower' and
-- 'co_borrower') against ONE private_financing_accounts row -- even though, per the handoff, only one
-- of the two is expected to receive portal access initially (the other's row simply stays 'invited'
-- indefinitely, or is claimed later; nothing in this schema requires both to be active).
--
-- Borrower identity stays OWNER-SCOPED (owner_id, id), matching rental_tenants' own established
-- pattern, rather than becoming a single global cross-seller identity table. A real person who borrows
-- from two different sellers gets two separate private_financing_borrowers rows (one per owner_id),
-- each independently claimable by the same real auth_user_id -- exactly how rental_tenants already
-- handles a tenant renting from two different landlords. This was a deliberate choice, not an
-- oversight: revocation and claim boundaries both naturally align with owner_id silos (a seller
-- revoking access to THEIR account must never be able to affect a borrower's relationship with a
-- DIFFERENT seller), and introducing a non-siloed global identity table would be a significant
-- departure from every other table in this codebase for a property this schema does not need a global
-- table to provide -- "one borrower in multiple financing accounts" is fully satisfied within a single
-- owner_id via multiple private_financing_account_borrowers rows against one identity row.
--
-- ============================================================================================
-- REVISION 2 -- BORROWER LEDGER READ REPLACED: A GUARDED RPC, NOT A VIEW
-- ============================================================================================
-- The first draft used a view (private_financing_borrower_visible_events) as the borrower's redaction
-- boundary, reasoning informally that a non-security_invoker view would run with the view owner's
-- (postgres') RLS-bypassing privileges and that its own WHERE clause would therefore be the complete
-- authorization check. That reasoning was never demonstrated against real Postgres/Supabase execution
-- semantics -- view ownership, search_path resolution, and RLS interaction are exactly the kind of
-- thing that looks right on paper and fails in a specific runtime configuration. This revision replaces
-- the view entirely with read_private_financing_borrower_events(p_account_id) -- see below -- a
-- narrowly scoped SECURITY DEFINER function that: verifies the caller's borrower membership on the
-- SPECIFIC account requested, INSIDE the function body, before returning a single row; uses a fixed
-- `search_path = public`; fully schema-qualifies every table reference (public.private_financing_*);
-- has PUBLIC execution revoked; grants EXECUTE only to `authenticated`; declares an explicit, fixed
-- RETURNS TABLE column list that structurally cannot include internal_note, idempotency_key,
-- created_by, or the new payment_method/external_evidence_reference columns (they are not in the
-- SELECT list -- there is no code path that could return them); and returns zero rows (not an error)
-- for an account the caller has no active membership on, so a borrower cannot distinguish "this account
-- doesn't exist" from "you have no access to it" via an error-vs-empty-result side channel, and cannot
-- probe for the existence of other sellers' accounts by id. No borrower SELECT policy exists on
-- private_financing_events at all -- this function is the ONLY borrower-facing read path, and it never
-- delegates to RLS for its authorization decision.
--
-- ============================================================================================
-- REVISION 3 -- PROPERTY LINKAGE: OMITTED, PER REPOSITORY REALITY
-- ============================================================================================
-- Inspection (not assumption) of supabase/migrations/ found NO master "properties" table anywhere in
-- this codebase for landlord-owned rental properties. rental_units (20260812000100_create_rental_
-- identity.sql) carries `property_id text not null` as a bare grouping VALUE, never FK-constrained to
-- any table -- confirmed explicitly by 20260824060000_add_property_financial_setup.sql's own comment:
-- "property_id is deliberately not a foreign key to rental_units: rental_units has no unique constraint
-- on property_id alone." Every other property_id column found in this codebase (rental_leases,
-- property_rules, property_valuations, financial_events, property_financial_setups) is the same:
-- unconstrained text, validated (where validated at all) via an RPC-level `exists (select 1 from
-- rental_units where owner_id = ... and property_id = ...)` check, e.g.
-- financial_assets.linked_property_id (20260825010000_add_financial_asset_registry.sql). There is
-- structurally nothing to add a real foreign key TO. Per the explicit instruction to either add a
-- correct FK or omit the column rather than leave a misleading unconstrained one, this migration OMITS
-- property_id from private_financing_accounts entirely for SF-1. Personal Loans were always required
-- to support no property relationship at all, and Seller Financing's own ledger math has no structural
-- need for it either. If a real product need for property association emerges later, the correct
-- future shape (matching financial_assets' own precedent exactly) is an additive, nullable
-- `property_id text` column validated via the same RPC-level existence-check pattern -- never a hard FK
-- to a table that does not exist, and never added preemptively "because the roadmap mentions it."
--
-- ============================================================================================
-- REVISION 4 -- MEMBERSHIP-SAFE TERMS VERSIONING
-- ============================================================================================
-- private_financing_components remains insert-only (no UPDATE/DELETE policy). This revision adds a
-- BEFORE INSERT trigger (enforce_private_financing_component_version_ordering, below) that REJECTS a
-- new version whose effective_date does not strictly exceed every prior version's effective_date for
-- the SAME (owner_id, account_id, component_type) chain -- this is what makes "no overlapping or
-- ambiguous active versions" a real, enforced database fact rather than a documented intention:
-- replay-by-date (`where effective_date <= :asOfDate order by effective_date desc limit 1`) can never
-- have two candidate rows tie for "most recent as of date X," because the trigger structurally
-- prevents that state from ever being reached. component_type + version_number together are the stable
-- identity across versions (unique (owner_id, account_id, component_type, version_number) below); a
-- new version-2 row for 'interest_bearing' can never "accidentally look like a second interest_bearing
-- component" to correctly-written code, because correct code always filters to the CURRENT version
-- (max version_number, or the row from private_financing_current_components below) rather than summing
-- every row for a component_type blindly. private_financing_current_components (a plain,
-- security_invoker view -- not a security boundary, so revision 2's view concerns do not apply to it;
-- it inherits the base table's existing owner/borrower RLS exactly) is provided as the safe default
-- read path for "what are this account's CURRENT terms," so that trap is avoided by construction for
-- the common case, not merely documented.
--
-- ============================================================================================
-- REVISION 5 -- LEDGER-SEQUENCE RPC HARDENING
-- ============================================================================================
-- append_private_financing_event already: checks has_workspace_access(p_owner_id) BEFORE acquiring the
-- account row lock (authorization precedes allocation); performs the counter increment and the event
-- INSERT in the same function invocation, which is one transaction by ordinary PL/pgSQL semantics -- if
-- ANY statement in the function raises, Postgres unwinds every effect the function made, including an
-- earlier successful INSERT, back to the state before the function was called (nothing partial is ever
-- left behind); never accepts ledger_sequence as a parameter at all (the value is entirely internal,
-- named v_seq, computed from the locked counter -- there is no p_ledger_sequence argument for a caller
-- to supply or override); and structurally cannot let account owner and event owner diverge, because
-- the account lookup itself is `where owner_id = p_owner_id and id = p_account_id` -- if p_owner_id
-- does not match the account's real owner, the lookup returns no row and the function raises "not
-- found" before any insert is attempted. This revision adds: full public.-schema-qualification of every
-- table reference inside every function body in this migration (previously only some were qualified);
-- an explicit comment confirming no dynamic SQL (no EXECUTE, no format()) and no user-controlled
-- relation/function name appears anywhere in this file (every identifier is a literal in the SQL text,
-- never constructed from a parameter); and PUBLIC execute was already revoked on every function --
-- unchanged, reconfirmed by the migration tests below.
--
-- ============================================================================================
-- REVISION 6 -- PAYOFF-OFFER AUTHORIZATION IS SELLER-ONLY; BORROWER ACCEPTANCE IS DEFERRED
-- ============================================================================================
-- transition_private_financing_payoff_offer_status's ONLY authorization check is
-- has_workspace_access(p_owner_id) -- there was never a borrower-membership branch in it, in either
-- draft, so a borrower could never call it to create a concession, change the offered amount, extend
-- expiration, mark an offer paid, cancel ledger history, or close an account; has_workspace_access
-- checks OWNER workspace membership specifically and returns false for any borrower's auth.uid(). This
-- revision makes that explicit rather than implicit: the function's own comment now states plainly that
-- it is SELLER-ONLY, and that borrower_accepted_at/borrower_acceptance_method/
-- borrower_acceptance_reference on private_financing_payoff_offers are SELLER-RECORDED evidence of an
-- acceptance that happened through an external channel (e-signature, email, verbal confirmation the
-- seller documents) -- NOT a borrower's own authenticated in-app action. Per the explicit instruction
-- to defer borrower-initiated acceptance rather than add an unsafe generalized (dual seller/borrower)
-- transition function, this migration does NOT add a separate borrower-facing acceptance RPC. A
-- borrower today can only ever SELECT their own payoff offers (see RLS below); a true self-service
-- borrower acceptance path recording their own authenticated membership and immutable evidence is
-- explicitly future (SF-2+) scope, requiring its own narrowly-scoped function analogous to
-- read_private_financing_borrower_events, never a loosened version of this one.
--
-- ============================================================================================
-- NEW -- EXTERNAL/OFF-PLATFORM PAYMENT RECORDING (Venmo, Cash App, Zelle, PayPal, bank transfer, cash,
-- check, money order)
-- ============================================================================================
-- A new event_origin, 'manual_external', is added: a SELLER-CONFIRMED record of a payment actually
-- received through an off-platform channel. It is deliberately distinct from 'manual_import' (which
-- reconstructs HISTORICAL records, e.g. South Main's 48-payment backfill, where no single human "did"
-- any one row) -- manual_external records a NEWLY received payment going forward, and is the one origin
-- that is BOTH attributable to a real authenticated human (created_by is required, exactly like
-- interactive_user) AND duplicate-protected (source_reference and idempotency_key are both required,
-- exactly like the import origins) -- because recording something that happened elsewhere is genuinely
-- prone to accidental re-entry in a way a single live UI click is not. payment_method and
-- external_evidence_reference are new nullable columns on private_financing_events, required (the
-- former) only for a manual_external payment_posted event, and forbidden on every other event type;
-- external_evidence_reference (an optional pointer to a privately-stored receipt/screenshot -- no
-- upload mechanism is implemented here, this is schema-only, matching the same "future boundary,
-- without implementing the integration" pattern already used for source_reference/event_origin) is
-- deliberately absent from read_private_financing_borrower_events' column list, exactly like
-- internal_note -- "keep screenshots private unless the seller deliberately shares them" is enforced
-- the same structural way internal_note already is. A new read-only, has_workspace_access-gated RPC,
-- find_private_financing_external_payment_duplicate_candidates, lets a seller check for likely
-- duplicates (matching account, amount, payment method, and a nearby effective date, or an exact
-- source_reference match) BEFORE confirming a new manual_external payment -- it never blocks or
-- auto-rejects anything itself, since "likely duplicate" is a judgment call for the seller, not a hard
-- database invariant; the HARD, absolute duplicate guard remains the existing exact-match
-- idempotency_key uniqueness index, unchanged. Fee treatment (a payment app deducting its own fee
-- before the seller receives funds) reuses the exact mechanism already built in Checkpoint C's
-- previewStripeFeeReimbursement/principal_correction path -- that mechanism is not literally
-- Stripe-specific in its logic (it takes a fee amount and optionally posts it as a loan credit, kept
-- separate from a payment's own allocation by construction) and already generalizes to any processor's
-- fee without further schema change; this migration does not rename or duplicate it.
--
-- Preserved from the first draft, unchanged: no Stripe integration, no payment-account tables, no live
-- payment attempts, no Financial FORGE postings, no borrower invitations (the invitation FLOW/UI --
-- these tables can be written to directly by an owner via RLS, matching rental_tenants' own pattern,
-- but nothing here sends an email or builds a UI), no Production records, no credit reporting, no
-- personal-loan UI, no document generation. No foreign key or reference into rental_payments anywhere.
-- financial_accounts is never referenced (so a 'loan' liability misclassification is structurally
-- impossible here). landlord_payment_accounts is never referenced or altered.
--
-- ============================================================================================
-- NEW 2 -- PAYMENT-ACCEPTANCE POLICY (owner-approved requirement, added after Checkpoint D's first
-- approval, before the SF-1 closeout)
-- ============================================================================================
-- A seller-controlled, closed policy governing what a BORROWER-INITIATED ONLINE payment amount would be
-- allowed to be: 'partial_allowed', 'full_amount_or_more', or 'exact_amount_only' -- a single closed
-- three-value enum, never two independent booleans (which could represent an incoherent state like
-- "partial allowed AND exact only"). This is deliberately NOT the same behavior as manual_external
-- (recording a payment the seller confirms actually arrived off-platform) -- see the decoupling note
-- below. No online-payment initiation of any kind is implemented by this migration; this section defines
-- and proves the policy/authorization/versioning/validation BOUNDARY only, per explicit instruction.
--
-- Explicit at account opening, never a silent default: open_private_financing_account now requires
-- p_payment_acceptance_policy as a plain (non-defaulted) parameter, and inserts the account's own
-- version-1 servicing-policy row in the same transaction as the account/components/account_opened event.
-- South Main's own policy value will be chosen during its later import review (not by this migration) --
-- its 48 historical payments were recorded via manual_import, which this policy table never gates (see
-- decoupling note below), so whatever online policy is chosen later cannot retroactively invalidate them.
--
-- Prospective, auditable, append-only versioning: private_financing_servicing_policy_versions mirrors
-- private_financing_components' own version-chain pattern (Revision 4) almost exactly --
-- enforce_private_financing_servicing_policy_version_ordering (a BEFORE INSERT trigger) rejects any new
-- version whose effective_at does not strictly exceed every prior version's effective_at for the same
-- account, and the guarded RPC below additionally rejects an effective_at in the past outright (a
-- servicing-policy change can only ever take effect now or later, never retroactively) -- together these
-- make "the seller can change the policy prospectively but can never rewrite history" a real, enforced
-- database fact, not a documented intention. No UPDATE or DELETE policy exists for this table at all,
-- exactly like private_financing_events -- a prior version, once inserted, can never be altered.
--
-- Authorization: append_private_financing_servicing_policy_version's only check is
-- has_workspace_access(p_owner_id) -- true for the primary owner and any co-owner, never true for a
-- claimed borrower identity or an unrelated workspace -- exactly mirroring
-- transition_private_financing_payoff_offer_status's own seller-only authorization shape (Revision 6).
-- version and acting_seller_id are both computed/forced server-side inside the function, never trusted
-- from a caller-supplied value, exactly mirroring append_private_financing_event's own ledger_sequence and
-- created_by discipline.
--
-- Pure domain enforcement, decoupled from this schema: the actual accept/reject decision for a proposed
-- borrower payment amount is evaluatePaymentAcceptance() in
-- src/domains/private-financing/paymentAcceptancePolicy.js -- a pure, fail-closed JS function, not a
-- database function, because it has no I/O of its own: it takes an already-authoritative amountDueCents
-- (computed by the existing replayEvents.js/payoffQuote.js engine -- this migration adds no second balance
-- engine anywhere) plus a ledger-sequence snapshot for staleness detection (the same
-- highestLedgerSequenceAtQuoteTime idiom payoffQuote.js already established, never wall-clock time), and
-- returns accept/reject. Nothing in this migration calls it, because nothing in this migration accepts a
-- borrower-initiated payment amount at all yet -- see the decoupling note immediately below.
--
-- DECOUPLING (both directions, and this is deliberate, tested structurally): append_private_financing_event
-- never references private_financing_servicing_policy_versions, and
-- append_private_financing_servicing_policy_version never references private_financing_events. A
-- manual_external (Venmo/Cash App/Zelle/PayPal/bank transfer/cash/check/money order) or manual_import
-- payment is a SELLER CONFIRMING something that already happened off-platform -- the online
-- payment_acceptance_policy governs a fundamentally different act (a borrower initiating a NEW online
-- payment attempt) and must never block, gate, or even see the seller's confirmation of a real external
-- receipt. A confirmed external partial payment is posted through append_private_financing_event exactly
-- as before, for its true amount, and the remaining amount due stays visible via the existing
-- replay/payoff-quote engine regardless of what online policy is configured. A borrower's own "I paid"
-- notice -- which does not exist as a code path anywhere in this repository -- still cannot post a ledger
-- event or lower a balance: only append_private_financing_event can write to private_financing_events, its
-- only authorization check is has_workspace_access (seller/co-owner), and it has no borrower-membership
-- branch anywhere in its body, exactly as already true before this section was added.
--
-- No premature online-payment implementation: this migration adds no Stripe payment initiation, no
-- borrower payment UI, no payment-processor account table, and performs no live payment attempt against
-- any database. Server-side enforcement of this policy at actual payment initiation remains SF-2/SF-3
-- scope -- what this migration adds is the schema/authorization/versioning boundary that a future
-- initiation path would be structurally required to consult, plus the pure decision function it would
-- call, so that boundary cannot be designed around by accident later.
--
-- ============================================================================================
-- PARK RENTALS CROSSOVER COMPATIBILITY -- VERIFIED, NO SCHEMA CHANGE REQUIRED
-- ============================================================================================
-- Checked against governance/specifications/park-rentals-and-private-financing-crossover-handoff.md
-- (commit 867080c0c6c34e93464fc10741c9c5c80d09e7a3). Park Rentals is NOT activated, implemented, or
-- expanded by this migration -- this section is a compatibility verification only. Every constraint
-- that document asks Private Financing to preserve already holds, mostly as a direct consequence of
-- Revision 3 (property_id omitted entirely) and the pre-existing financial-separation boundary:
--   - No assumption that a seller-financed property is a single-family house: there is no property_id,
--     property-type, or house-type column anywhere in this schema to encode such an assumption.
--   - Optional future property/site relationship while Personal Loans need none: property_id's future
--     shape (documented in Revision 3) is an additive nullable column -- trivially compatible with a
--     later second-level site/space link (e.g. a park lot) added the same additive way.
--   - Borrower identity stays separate from rental-tenant/resident identity: private_financing_borrowers
--     has no foreign key to, and no column referencing, rental_tenants.
--   - One authenticated person can hold both a borrower and a resident membership without merging
--     permissions: private_financing_borrowers.auth_user_id and rental_tenants.auth_user_id are
--     independent nullable columns on independent, unrelated tables with independent RLS -- claiming
--     one never touches the other.
--   - Lot rent and loan payments stay in separate ledgers: private_financing_events has no foreign key
--     into rental_payments (unchanged financial-separation boundary, reconfirmed above).
--   - A future consolidated portal view is possible without combining balances: nothing here forces or
--     requires a merge at the database layer -- a future read-only view or API layer can query
--     read_private_financing_borrower_events() and the rental tenant-portal's own read path side by
--     side without either write path touching the other's rows.
--   - No duplicate Stripe account is created merely because rent and financing differ in accounting
--     treatment: this migration creates no processor-account table at all (Decision 4, still deferred);
--     that architecture remains an explicitly separate future decision, not something this schema
--     presupposes an answer to.
--   - Seller-financed manufactured homes on rented park lots are supportable later without a ledger
--     redesign: this follows directly from the four points above -- the financing account is already
--     generic (no property coupling, no house-type assumption) and already ledger-isolated from rent.
--   - Seller-confirmed external payments cannot be forged by a borrower claim: manual_external events
--     can only be written through append_private_financing_event(), whose only authorization check is
--     has_workspace_access(p_owner_id) -- a seller/co-owner check. A borrower has no INSERT policy and
--     no callable RPC that writes to private_financing_events at all, so a borrower-submitted "I paid"
--     claim structurally cannot change a balance, exactly as the crossover document requires for either
--     obligation.
-- No conflict was found; no correction was needed. Park properties, sites, utilities, reservations,
-- recurring park charges, combined payments, and Park Rentals UI remain entirely unimplemented, per the
-- explicit boundary in that document and in every Checkpoint D instruction so far.
--
-- ============================================================================================
-- EXACT DATA TYPES (unchanged from the first draft)
-- ============================================================================================
-- Posted money: bigint. Rates: integer basis points. Effective dates: date. Recorded timestamps:
-- timestamptz. IDs: text, server-generated via gen_random_uuid()::text inside the guarded RPCs (never
-- client-supplied). Enumerated values: text + CHECK, matching repository convention -- no native
-- Postgres ENUM type anywhere in this schema. No stored running balance or mutable accrued-interest
-- total exists anywhere. No column anywhere in this file is real/float/double precision/numeric.

create table if not exists private_financing_accounts (
    owner_id text not null,
    id text not null,
    product text not null check (product in ('seller_financing', 'personal_loan')),
    status text not null check (status in ('active', 'paid_off', 'written_off', 'cancelled')) default 'active',
    opened_date date not null,
    origination_principal_cents bigint not null check (origination_principal_cents > 0 and origination_principal_cents < 100000000000),
    late_fee_policy text not null check (late_fee_policy in ('disabled', 'enabled')) default 'disabled',
    interest_day_count_convention text not null check (interest_day_count_convention in ('actual_365')) default 'actual_365',
    platform_fee_cents integer not null check (platform_fee_cents between 0 and 1000) default 0,
    fee_payer text not null check (fee_payer in ('lender', 'borrower')) default 'lender',
    -- The locked per-account counter Revision 5 (and the original Clarification 2) requires -- see
    -- append_private_financing_event().
    next_ledger_sequence bigint not null default 1 check (next_ledger_sequence > 0),
    created_by text,
    updated_by text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (owner_id, id)
);

-- TERMS ARE INSERT-ONLY. See Revision 4 above for the version-ordering trigger and the
-- private_financing_current_components convenience view.
create table if not exists private_financing_components (
    owner_id text not null,
    id text not null,
    account_id text not null,
    component_type text not null check (component_type in ('interest_bearing', 'zero_interest')),
    version_number integer not null check (version_number > 0),
    original_principal_cents bigint not null check (original_principal_cents > 0 and original_principal_cents < 100000000000),
    rate_bps integer not null check (rate_bps >= 0 and rate_bps <= 10000),
    regular_payment_cents bigint not null check (regular_payment_cents >= 0 and regular_payment_cents < 100000000000),
    effective_date date not null,
    prior_version_id text,
    amendment_reason text,
    acting_seller_id text,
    borrower_acceptance_reference text,
    created_by text,
    created_at timestamptz not null default now(),
    primary key (owner_id, id),
    foreign key (owner_id, account_id) references private_financing_accounts (owner_id, id) on delete restrict,
    foreign key (owner_id, prior_version_id) references private_financing_components (owner_id, id),
    unique (owner_id, account_id, component_type, version_number),
    check (component_type <> 'zero_interest' or rate_bps = 0),
    check (version_number = 1 or (prior_version_id is not null and amendment_reason is not null and acting_seller_id is not null))
);

-- Enforces "no overlapping or ambiguous active versions" as a real, tested database constraint -- see
-- Revision 4. Fires regardless of whether the insert comes from a future amendment RPC or (in SF-1)
-- exclusively from open_private_financing_account's own version-1 inserts.
create or replace function enforce_private_financing_component_version_ordering()
returns trigger
language plpgsql
set search_path = public
as $$
declare
    v_max_prior_effective_date date;
begin
    if new.version_number > 1 then
        select max(effective_date) into v_max_prior_effective_date
          from public.private_financing_components
         where owner_id = new.owner_id and account_id = new.account_id and component_type = new.component_type
           and version_number < new.version_number;
        if v_max_prior_effective_date is null or new.effective_date <= v_max_prior_effective_date then
            raise exception 'A new component version must have an effective_date strictly after every prior version for the same component.'
                using errcode = '22023';
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists trg_private_financing_component_version_ordering on private_financing_components;
create trigger trg_private_financing_component_version_ordering
before insert on private_financing_components
for each row execute function enforce_private_financing_component_version_ordering();

-- Borrower IDENTITY (Revision 1) -- owner-scoped, mirrors rental_tenants' own claim shape. Minimal PII
-- by design: email, full_name, phone only. No SSN, no birth date, no identity-document fields.
create table if not exists private_financing_borrowers (
    owner_id text not null,
    id text not null,
    auth_user_id uuid,
    email text not null,
    full_name text,
    phone text,
    created_by text,
    updated_by text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (owner_id, id)
);
create unique index if not exists idx_private_financing_borrowers_owner_email
    on private_financing_borrowers (owner_id, lower(email));

-- Borrower ACCOUNT MEMBERSHIP (Revision 1) -- role, status, and every invitation/claim/revocation date
-- live here, per-account, separate from the stable identity row above.
create table if not exists private_financing_account_borrowers (
    owner_id text not null,
    id text not null,
    account_id text not null,
    borrower_id text not null,
    role text not null check (role in ('primary_borrower', 'co_borrower', 'guarantor')) default 'primary_borrower',
    status text not null check (status in ('invited', 'active', 'suspended', 'revoked')) default 'invited',
    invited_at timestamptz not null default now(),
    activated_at timestamptz,
    revoked_at timestamptz,
    created_by text,
    updated_by text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (owner_id, id),
    foreign key (owner_id, account_id) references private_financing_accounts (owner_id, id) on delete restrict,
    foreign key (owner_id, borrower_id) references private_financing_borrowers (owner_id, id) on delete restrict,
    unique (owner_id, account_id, borrower_id),
    check (status <> 'active' or activated_at is not null),
    check (status <> 'revoked' or revoked_at is not null)
);

-- Payment-acceptance policy, versioned and append-only -- see "NEW 2" above for full reasoning.
create table if not exists private_financing_servicing_policy_versions (
    owner_id text not null,
    id text not null,
    account_id text not null,
    version integer not null check (version > 0),
    payment_acceptance_policy text not null check (payment_acceptance_policy in (
        'partial_allowed', 'full_amount_or_more', 'exact_amount_only'
    )),
    effective_at timestamptz not null,
    acting_seller_id text not null,
    reason text,
    recorded_at timestamptz not null default now(),
    primary key (owner_id, id),
    foreign key (owner_id, account_id) references private_financing_accounts (owner_id, id) on delete restrict,
    unique (owner_id, account_id, version),
    -- Version 1 (set at account opening) needs no explanatory reason; every later change to an existing
    -- policy must record why, exactly like private_financing_components' own amendment_reason requirement.
    check (version = 1 or reason is not null)
);

-- Enforces "prospective, never backdated, never rewriting history" as a real, tested database constraint
-- -- mirrors enforce_private_financing_component_version_ordering (Revision 4) exactly, applied to policy
-- versions instead of loan terms.
create or replace function enforce_private_financing_servicing_policy_version_ordering()
returns trigger
language plpgsql
set search_path = public
as $$
declare
    v_max_prior_effective_at timestamptz;
begin
    if new.version > 1 then
        select max(effective_at) into v_max_prior_effective_at
          from public.private_financing_servicing_policy_versions
         where owner_id = new.owner_id and account_id = new.account_id and version < new.version;
        if v_max_prior_effective_at is null or new.effective_at <= v_max_prior_effective_at then
            raise exception 'A new servicing policy version must have an effective_at strictly after every prior version for the same account.'
                using errcode = '22023';
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists trg_private_financing_servicing_policy_version_ordering on private_financing_servicing_policy_versions;
create trigger trg_private_financing_servicing_policy_version_ordering
before insert on private_financing_servicing_policy_versions
for each row execute function enforce_private_financing_servicing_policy_version_ordering();

-- The immutable ledger. APPEND-ONLY: no INSERT/UPDATE/DELETE policy is granted to the plain
-- authenticated role at all -- every real write goes through append_private_financing_event()
-- (SECURITY DEFINER). No updated_by/updated_at column exists.
create table if not exists private_financing_events (
    owner_id text not null,
    id text not null,
    account_id text not null,
    event_type text not null check (event_type in (
        'account_opened', 'payment_posted', 'payment_reversal', 'principal_correction',
        'interest_correction', 'compensating_correction', 'payoff_concession', 'account_closed'
    )),
    event_origin text not null check (event_origin in (
        'interactive_user', 'stripe_webhook', 'system_import', 'manual_import', 'manual_external'
    )),
    created_by text,
    source_reference text,
    idempotency_key text,
    ledger_sequence bigint not null check (ledger_sequence > 0),
    effective_date date not null,
    recorded_at timestamptz not null default now(),
    reverses_event_id text,
    reason text,
    internal_note text,
    borrower_visible_explanation text,
    -- payment_posted / payment_reversal
    amount_cents bigint check (amount_cents is null or amount_cents > 0),
    interest_paid_cents bigint check (interest_paid_cents is null or interest_paid_cents >= 0),
    interest_bearing_principal_paid_cents bigint check (interest_bearing_principal_paid_cents is null or interest_bearing_principal_paid_cents >= 0),
    zero_interest_principal_paid_cents bigint check (zero_interest_principal_paid_cents is null or zero_interest_principal_paid_cents >= 0),
    unallocated_cents bigint check (unallocated_cents is null or unallocated_cents >= 0),
    principal_remaining_interest_bearing_cents bigint check (principal_remaining_interest_bearing_cents is null or principal_remaining_interest_bearing_cents >= 0),
    principal_remaining_zero_interest_cents bigint check (principal_remaining_zero_interest_cents is null or principal_remaining_zero_interest_cents >= 0),
    -- payment_posted only, and only when event_origin = 'manual_external' (see NEW section above)
    payment_method text check (payment_method is null or payment_method in (
        'venmo', 'cash_app', 'zelle', 'paypal', 'bank_transfer', 'cash', 'check', 'money_order', 'other'
    )),
    -- Private by construction: never selected by read_private_financing_borrower_events.
    external_evidence_reference text,
    -- principal_correction / interest_correction / compensating_correction
    component_type text check (component_type is null or component_type in ('interest_bearing', 'zero_interest')),
    correction_basis text check (correction_basis is null or correction_basis in ('discretionary_concession', 'contractual_administrative')),
    delta_cents bigint check (delta_cents is null or delta_cents <> 0),
    corrected_component_principal_remaining_cents_after bigint check (corrected_component_principal_remaining_cents_after is null or corrected_component_principal_remaining_cents_after >= 0),
    -- payoff_concession
    interest_bearing_delta_cents bigint check (interest_bearing_delta_cents is null or interest_bearing_delta_cents <= 0),
    zero_interest_delta_cents bigint check (zero_interest_delta_cents is null or zero_interest_delta_cents <= 0),
    -- account_closed
    closure_reason text check (closure_reason is null or closure_reason in ('paid_in_full', 'payoff_concession_applied', 'written_off', 'cancelled')),
    payoff_concession_event_id text,
    primary key (owner_id, id),
    foreign key (owner_id, account_id) references private_financing_accounts (owner_id, id) on delete restrict,
    foreign key (owner_id, reverses_event_id) references private_financing_events (owner_id, id),
    foreign key (owner_id, payoff_concession_event_id) references private_financing_events (owner_id, id),
    unique (owner_id, account_id, ledger_sequence),
    check (
        (event_origin in ('interactive_user', 'manual_external') and created_by is not null)
        or (event_origin not in ('interactive_user', 'manual_external') and created_by is null)
    ),
    check (event_origin not in ('stripe_webhook', 'manual_external') or source_reference is not null),
    check (event_origin not in ('manual_import', 'system_import', 'manual_external') or idempotency_key is not null),
    check (event_origin <> 'interactive_user' or (source_reference is null and idempotency_key is null)),
    check (
        (event_type in ('payment_reversal', 'compensating_correction') and reverses_event_id is not null)
        or (event_type not in ('payment_reversal', 'compensating_correction') and reverses_event_id is null)
    ),
    check (
        event_type not in ('payment_reversal', 'principal_correction', 'interest_correction', 'compensating_correction', 'payoff_concession')
        or (reason is not null and btrim(reason) <> '')
    ),
    -- payment_method is required for a manual_external payment_posted event, and forbidden everywhere
    -- else; external_evidence_reference is only ever meaningful on a payment_posted event.
    check (event_type <> 'payment_posted' or event_origin <> 'manual_external' or payment_method is not null),
    check (event_type = 'payment_posted' or (payment_method is null and external_evidence_reference is null)),
    check (
        -- A SEARCHED case (no subject expression) -- a simple `case event_type when 'a', 'b' then`
        -- form is not valid PostgreSQL syntax; a WHEN clause cannot take comma-separated values.
        -- Confirmed against a real local PostgreSQL instance during Checkpoint D live validation (the
        -- first drafts of this file never caught this -- static text assertions cannot parse SQL).
        case
            when event_type = 'account_opened' then
                amount_cents is null and interest_paid_cents is null and interest_bearing_principal_paid_cents is null
                and zero_interest_principal_paid_cents is null and unallocated_cents is null
                and principal_remaining_interest_bearing_cents is null and principal_remaining_zero_interest_cents is null
                and component_type is null and correction_basis is null and delta_cents is null
                and corrected_component_principal_remaining_cents_after is null
                and interest_bearing_delta_cents is null and zero_interest_delta_cents is null
                and closure_reason is null and payoff_concession_event_id is null
            when event_type in ('payment_posted', 'payment_reversal') then
                amount_cents is not null
                and interest_paid_cents is not null and interest_bearing_principal_paid_cents is not null
                and zero_interest_principal_paid_cents is not null and unallocated_cents is not null
                and interest_paid_cents + interest_bearing_principal_paid_cents + zero_interest_principal_paid_cents + unallocated_cents = amount_cents
                and principal_remaining_interest_bearing_cents is not null and principal_remaining_zero_interest_cents is not null
                and component_type is null and correction_basis is null and delta_cents is null
                and corrected_component_principal_remaining_cents_after is null
                and interest_bearing_delta_cents is null and zero_interest_delta_cents is null
                and closure_reason is null and payoff_concession_event_id is null
            when event_type = 'principal_correction' then
                component_type is not null and correction_basis is not null
                and delta_cents is not null and corrected_component_principal_remaining_cents_after is not null
                and amount_cents is null and interest_paid_cents is null and interest_bearing_principal_paid_cents is null
                and zero_interest_principal_paid_cents is null and unallocated_cents is null
                and principal_remaining_interest_bearing_cents is null and principal_remaining_zero_interest_cents is null
                and interest_bearing_delta_cents is null and zero_interest_delta_cents is null
                and closure_reason is null and payoff_concession_event_id is null
            when event_type = 'interest_correction' then
                correction_basis is not null and delta_cents is not null
                and component_type is null and corrected_component_principal_remaining_cents_after is null
                and amount_cents is null and interest_paid_cents is null and interest_bearing_principal_paid_cents is null
                and zero_interest_principal_paid_cents is null and unallocated_cents is null
                and principal_remaining_interest_bearing_cents is null and principal_remaining_zero_interest_cents is null
                and interest_bearing_delta_cents is null and zero_interest_delta_cents is null
                and closure_reason is null and payoff_concession_event_id is null
            when event_type = 'compensating_correction' then
                delta_cents is not null
                and correction_basis is null and corrected_component_principal_remaining_cents_after is null
                and amount_cents is null and interest_paid_cents is null and interest_bearing_principal_paid_cents is null
                and zero_interest_principal_paid_cents is null and unallocated_cents is null
                and principal_remaining_interest_bearing_cents is null and principal_remaining_zero_interest_cents is null
                and interest_bearing_delta_cents is null and zero_interest_delta_cents is null
                and closure_reason is null and payoff_concession_event_id is null
            when event_type = 'payoff_concession' then
                interest_bearing_delta_cents is not null and zero_interest_delta_cents is not null
                and (interest_bearing_delta_cents <> 0 or zero_interest_delta_cents <> 0)
                and principal_remaining_interest_bearing_cents is not null and principal_remaining_interest_bearing_cents = 0
                and principal_remaining_zero_interest_cents is not null and principal_remaining_zero_interest_cents = 0
                and amount_cents is null and interest_paid_cents is null and interest_bearing_principal_paid_cents is null
                and zero_interest_principal_paid_cents is null and unallocated_cents is null
                and component_type is null and correction_basis is null and delta_cents is null
                and corrected_component_principal_remaining_cents_after is null
                and closure_reason is null and payoff_concession_event_id is null
            when event_type = 'account_closed' then
                closure_reason is not null
                and (closure_reason <> 'payoff_concession_applied' or payoff_concession_event_id is not null)
                and (closure_reason = 'payoff_concession_applied' or payoff_concession_event_id is null)
                and amount_cents is null and interest_paid_cents is null and interest_bearing_principal_paid_cents is null
                and zero_interest_principal_paid_cents is null and unallocated_cents is null
                and principal_remaining_interest_bearing_cents is null and principal_remaining_zero_interest_cents is null
                and component_type is null and correction_basis is null and delta_cents is null
                and corrected_component_principal_remaining_cents_after is null
                and interest_bearing_delta_cents is null and zero_interest_delta_cents is null
            else false
        end
    )
);
create unique index if not exists idx_private_financing_events_idempotency
    on private_financing_events (owner_id, account_id, idempotency_key) where idempotency_key is not null;
create unique index if not exists idx_private_financing_events_reverses_unique
    on private_financing_events (owner_id, reverses_event_id) where reverses_event_id is not null;
create index if not exists idx_private_financing_events_account_sequence
    on private_financing_events (owner_id, account_id, ledger_sequence);

create table if not exists private_financing_payoff_offers (
    owner_id text not null,
    id text not null,
    account_id text not null,
    quote_id text not null,
    calculated_payoff_cents bigint not null check (calculated_payoff_cents >= 0),
    seller_concession_cents bigint not null check (seller_concession_cents >= 0),
    offered_payoff_cents bigint not null check (offered_payoff_cents >= 0),
    accrued_interest_cents bigint not null check (accrued_interest_cents >= 0),
    interest_bearing_principal_cents bigint not null check (interest_bearing_principal_cents >= 0),
    zero_interest_principal_cents bigint not null check (zero_interest_principal_cents >= 0),
    calculated_through_date date not null,
    status text not null check (status in ('pending', 'accepted', 'expired', 'withdrawn', 'paid', 'cancelled')) default 'pending',
    issued_at date not null,
    expires_at date not null,
    seller_acting_user_id text not null,
    -- SELLER-RECORDED evidence of an acceptance that happened through an external channel -- see
    -- Revision 6. Not a borrower's own authenticated in-app action; that path is deferred.
    borrower_accepted_at date,
    borrower_acceptance_method text,
    borrower_acceptance_reference text,
    qualifying_payment_event_id text,
    qualifying_concession_event_id text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (owner_id, id),
    foreign key (owner_id, account_id) references private_financing_accounts (owner_id, id) on delete restrict,
    foreign key (owner_id, qualifying_payment_event_id) references private_financing_events (owner_id, id),
    foreign key (owner_id, qualifying_concession_event_id) references private_financing_events (owner_id, id),
    check (offered_payoff_cents = calculated_payoff_cents - seller_concession_cents),
    check (expires_at > issued_at),
    check (status not in ('accepted', 'paid') or (borrower_accepted_at is not null and borrower_acceptance_method is not null)),
    check (status <> 'paid' or qualifying_payment_event_id is not null)
);

-- FINANCIAL SEPARATION (requirement B, unchanged from the first draft): no FK into rental_payments, no
-- reference to financial_accounts (so 'loan' liability misclassification is impossible here), no
-- reference to landlord_payment_accounts, no private_financing_payment_accounts table, no Financial
-- FORGE posting anywhere in this migration.

alter table private_financing_accounts enable row level security;
alter table private_financing_accounts force row level security;
alter table private_financing_components enable row level security;
alter table private_financing_components force row level security;
alter table private_financing_borrowers enable row level security;
alter table private_financing_borrowers force row level security;
alter table private_financing_account_borrowers enable row level security;
alter table private_financing_account_borrowers force row level security;
alter table private_financing_events enable row level security;
alter table private_financing_events force row level security;
alter table private_financing_payoff_offers enable row level security;
alter table private_financing_payoff_offers force row level security;
alter table private_financing_servicing_policy_versions enable row level security;
alter table private_financing_servicing_policy_versions force row level security;

-- -- Seller-side --

create policy "private_financing_accounts_owner_all" on private_financing_accounts
    for all to authenticated
    using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

create policy "private_financing_components_owner_select" on private_financing_components
    for select to authenticated using (has_workspace_access(owner_id));
create policy "private_financing_components_owner_insert" on private_financing_components
    for insert to authenticated with check (has_workspace_access(owner_id));

create policy "private_financing_borrowers_owner_all" on private_financing_borrowers
    for all to authenticated
    using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

create policy "private_financing_account_borrowers_owner_all" on private_financing_account_borrowers
    for all to authenticated
    using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

-- No INSERT, UPDATE, or DELETE policy for the plain authenticated role on private_financing_events at
-- all -- every write goes through append_private_financing_event() (SECURITY DEFINER, below).
create policy "private_financing_events_owner_select" on private_financing_events
    for select to authenticated using (has_workspace_access(owner_id));

create policy "private_financing_payoff_offers_owner_select" on private_financing_payoff_offers
    for select to authenticated using (has_workspace_access(owner_id));
create policy "private_financing_payoff_offers_owner_insert" on private_financing_payoff_offers
    for insert to authenticated with check (has_workspace_access(owner_id) and status = 'pending');

-- No INSERT, UPDATE, or DELETE policy at all -- every write goes through
-- append_private_financing_servicing_policy_version() (SECURITY DEFINER, below) or
-- open_private_financing_account()'s own version-1 insert (also SECURITY DEFINER, `set row_security =
-- off`). Immutable and append-only, exactly like private_financing_events. No borrower policy exists for
-- this table in either direction -- deliberately deferred, since no borrower-facing online-payment UI
-- exists yet to need it; a borrower cannot read, let alone write, a servicing-policy row in SF-1.
create policy "private_financing_servicing_policy_versions_owner_select" on private_financing_servicing_policy_versions
    for select to authenticated using (has_workspace_access(owner_id));

-- -- Borrower-side -- a borrower can only ever SELECT; nothing below grants INSERT/UPDATE/DELETE to a
-- -- borrower on any table, so a borrower structurally cannot create credits, corrections, reversals,
-- -- concessions, terms, closures, or seller notes. Every borrower policy joins through
-- -- private_financing_account_borrowers (membership) -> private_financing_borrowers (identity),
-- -- requiring an ACTIVE membership row and a claimed identity (auth_user_id = auth.uid()). --

create policy "private_financing_accounts_borrower_select" on private_financing_accounts
    for select to authenticated
    using (exists (
        select 1 from private_financing_account_borrowers m
        join private_financing_borrowers b on b.owner_id = m.owner_id and b.id = m.borrower_id
        where m.owner_id = private_financing_accounts.owner_id
          and m.account_id = private_financing_accounts.id
          and b.auth_user_id = auth.uid()
          and m.status = 'active'
    ));

create policy "private_financing_components_borrower_select" on private_financing_components
    for select to authenticated
    using (exists (
        select 1 from private_financing_account_borrowers m
        join private_financing_borrowers b on b.owner_id = m.owner_id and b.id = m.borrower_id
        where m.owner_id = private_financing_components.owner_id
          and m.account_id = private_financing_components.account_id
          and b.auth_user_id = auth.uid()
          and m.status = 'active'
    ));

-- A borrower sees only their OWN identity row.
create policy "private_financing_borrowers_self_select" on private_financing_borrowers
    for select to authenticated using (auth_user_id = auth.uid());

-- A borrower sees only their OWN membership rows (not co-borrowers' membership on the same account) --
-- a deliberately conservative default, loosenable later if a real product need for mutual co-borrower
-- visibility arises.
create policy "private_financing_account_borrowers_self_select" on private_financing_account_borrowers
    for select to authenticated
    using (exists (
        select 1 from private_financing_borrowers b
        where b.owner_id = private_financing_account_borrowers.owner_id
          and b.id = private_financing_account_borrowers.borrower_id
          and b.auth_user_id = auth.uid()
    ));

-- Deliberately NO borrower SELECT policy on private_financing_events -- see Revision 2. The only
-- borrower-facing ledger read path is read_private_financing_borrower_events(), below.

create policy "private_financing_payoff_offers_borrower_select" on private_financing_payoff_offers
    for select to authenticated
    using (exists (
        select 1 from private_financing_account_borrowers m
        join private_financing_borrowers b on b.owner_id = m.owner_id and b.id = m.borrower_id
        where m.owner_id = private_financing_payoff_offers.owner_id
          and m.account_id = private_financing_payoff_offers.account_id
          and b.auth_user_id = auth.uid()
          and m.status = 'active'
    ));

-- A plain, non-security-sensitive convenience view: the CURRENT (highest version_number) row per
-- (account, component_type). security_invoker = true so it inherits the base table's own owner/borrower
-- RLS exactly -- unlike Revision 2's concern (which was about a REDACTION boundary), this view exposes
-- nothing the base table wouldn't already permit the querying role to see.
create view private_financing_current_components
with (security_invoker = true) as
select distinct on (owner_id, account_id, component_type) *
from private_financing_components
order by owner_id, account_id, component_type, version_number desc;

-- The same convenience pattern applied to servicing policy: the CURRENTLY EFFECTIVE policy per account
-- (the latest version whose effective_at has already arrived, never a future-dated one that hasn't taken
-- effect yet). security_invoker = true, inherits the base table's owner-only RLS exactly.
create view private_financing_current_servicing_policy
with (security_invoker = true) as
select distinct on (owner_id, account_id) *
from private_financing_servicing_policy_versions
where effective_at <= now()
order by owner_id, account_id, effective_at desc, version desc;

-- -- Service/webhook -- no broad service-role shortcut is granted anywhere: every function below is
-- -- granted to `authenticated` only, and append_private_financing_event explicitly rejects the two
-- -- origins a browser-authenticated caller must never be able to claim. --

-- ============================================================================================
-- GUARDED RPCS
-- ============================================================================================
-- None of the functions below use dynamic SQL (no EXECUTE, no format()-built statements) and none
-- accept a table, column, or function NAME as a parameter -- every identifier referenced in every
-- function body is a literal in the SQL text, never constructed from caller input. Every table
-- reference is fully schema-qualified (public.private_financing_*, public.workspace_members via
-- has_workspace_access, auth.users) and every SECURITY DEFINER function pins `search_path = public`.

create or replace function append_private_financing_event(
    p_owner_id text,
    p_account_id text,
    p_event_type text,
    p_event_origin text,
    p_effective_date date,
    p_created_by text default null,
    p_source_reference text default null,
    p_idempotency_key text default null,
    p_reverses_event_id text default null,
    p_reason text default null,
    p_internal_note text default null,
    p_borrower_visible_explanation text default null,
    p_amount_cents bigint default null,
    p_interest_paid_cents bigint default null,
    p_interest_bearing_principal_paid_cents bigint default null,
    p_zero_interest_principal_paid_cents bigint default null,
    p_unallocated_cents bigint default null,
    p_principal_remaining_interest_bearing_cents bigint default null,
    p_principal_remaining_zero_interest_cents bigint default null,
    p_payment_method text default null,
    p_external_evidence_reference text default null,
    p_component_type text default null,
    p_correction_basis text default null,
    p_delta_cents bigint default null,
    p_corrected_component_principal_remaining_cents_after bigint default null,
    p_interest_bearing_delta_cents bigint default null,
    p_zero_interest_delta_cents bigint default null,
    p_closure_reason text default null,
    p_payoff_concession_event_id text default null
)
returns private_financing_events
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
    v_authenticated_user uuid := auth.uid();
    v_new_id text;
    v_seq bigint;
    v_target public.private_financing_events%rowtype;
    v_row public.private_financing_events%rowtype;
begin
    if v_authenticated_user is null then
        raise exception 'An authenticated user is required.' using errcode = '42501';
    end if;
    -- Authorization is checked BEFORE any sequence allocation (Revision 5).
    if not has_workspace_access(p_owner_id) then
        raise exception 'Owner does not match authenticated workspace.' using errcode = '42501';
    end if;

    -- Webhook authority cannot be reused by browser clients: this function is granted to
    -- `authenticated` (see the grant below), so it must never accept the two origins a real human
    -- cannot legitimately assert from a browser session.
    if p_event_origin not in ('interactive_user', 'manual_import', 'manual_external') then
        raise exception 'append_private_financing_event does not accept event_origin % from the authenticated role.', p_event_origin
            using errcode = '42501';
    end if;

    -- Truthful attribution: interactive_user and manual_external both require the real authenticated
    -- human, never a client-supplied value; manual_import forbids one entirely.
    if p_event_origin in ('interactive_user', 'manual_external') then
        p_created_by := v_authenticated_user::text;
    elsif p_created_by is not null then
        raise exception 'created_by must be null when event_origin is not interactive_user or manual_external.' using errcode = '22023';
    end if;

    -- Clarification 2 / Revision 5: lock the account's own counter row for the rest of this
    -- transaction. Concurrent calls against the SAME account serialize here; different accounts never
    -- block each other. ledger_sequence itself is never a parameter this function accepts.
    select next_ledger_sequence into v_seq
      from public.private_financing_accounts
     where owner_id = p_owner_id and id = p_account_id
       for update;
    if v_seq is null then
        raise exception 'Financing account was not found.' using errcode = '22023';
    end if;

    if p_idempotency_key is not null and exists (
        select 1 from public.private_financing_events
         where owner_id = p_owner_id and account_id = p_account_id and idempotency_key = p_idempotency_key
    ) then
        raise exception 'Duplicate idempotency_key for this financing account.' using errcode = '23505';
    end if;

    if p_reverses_event_id is not null then
        select * into v_target from public.private_financing_events where owner_id = p_owner_id and id = p_reverses_event_id;
        if v_target.id is null then
            raise exception 'reverses_event_id does not reference an existing event.' using errcode = '22023';
        end if;
        if v_target.account_id <> p_account_id then
            raise exception 'A reversal cannot cross financing-account boundaries.' using errcode = '42501';
        end if;
        if p_event_type = 'payment_reversal' and v_target.event_type <> 'payment_posted' then
            raise exception 'payment_reversal can only reverse a payment_posted event.' using errcode = '22023';
        end if;
        if p_event_type = 'compensating_correction' and v_target.event_type not in ('principal_correction', 'interest_correction', 'payoff_concession') then
            raise exception 'compensating_correction cannot reverse a % event.', v_target.event_type using errcode = '22023';
        end if;
        if p_effective_date < v_target.effective_date then
            raise exception 'A reversal cannot predate the event it reverses.' using errcode = '22023';
        end if;
        if exists (select 1 from public.private_financing_events where owner_id = p_owner_id and reverses_event_id = p_reverses_event_id) then
            raise exception 'Event has already been reversed and cannot be reversed again.' using errcode = '23505';
        end if;
    end if;

    if p_event_type = 'account_closed' and p_payoff_concession_event_id is not null then
        select * into v_target from public.private_financing_events where owner_id = p_owner_id and id = p_payoff_concession_event_id;
        if v_target.id is null or v_target.account_id <> p_account_id or v_target.event_type <> 'payoff_concession' then
            raise exception 'payoff_concession_event_id must reference a payoff_concession event on the same account.' using errcode = '22023';
        end if;
    end if;

    v_new_id := 'pf_evt_' || gen_random_uuid()::text;

    -- The INSERT happens before the counter UPDATE; if either fails, PL/pgSQL's ordinary transactional
    -- semantics unwind BOTH (Revision 5) -- there is no way for this function to leave the counter
    -- incremented without a corresponding event row, or vice versa.
    insert into public.private_financing_events (
        owner_id, id, account_id, event_type, event_origin, created_by, source_reference,
        idempotency_key, ledger_sequence, effective_date, reverses_event_id, reason,
        internal_note, borrower_visible_explanation, amount_cents, interest_paid_cents,
        interest_bearing_principal_paid_cents, zero_interest_principal_paid_cents, unallocated_cents,
        principal_remaining_interest_bearing_cents, principal_remaining_zero_interest_cents,
        payment_method, external_evidence_reference,
        component_type, correction_basis, delta_cents, corrected_component_principal_remaining_cents_after,
        interest_bearing_delta_cents, zero_interest_delta_cents, closure_reason, payoff_concession_event_id
    ) values (
        p_owner_id, v_new_id, p_account_id, p_event_type, p_event_origin, p_created_by, p_source_reference,
        p_idempotency_key, v_seq, p_effective_date, p_reverses_event_id, p_reason,
        p_internal_note, p_borrower_visible_explanation, p_amount_cents, p_interest_paid_cents,
        p_interest_bearing_principal_paid_cents, p_zero_interest_principal_paid_cents, p_unallocated_cents,
        p_principal_remaining_interest_bearing_cents, p_principal_remaining_zero_interest_cents,
        p_payment_method, p_external_evidence_reference,
        p_component_type, p_correction_basis, p_delta_cents, p_corrected_component_principal_remaining_cents_after,
        p_interest_bearing_delta_cents, p_zero_interest_delta_cents, p_closure_reason, p_payoff_concession_event_id
    ) returning * into v_row;

    update public.private_financing_accounts set next_ledger_sequence = v_seq + 1, updated_at = now()
     where owner_id = p_owner_id and id = p_account_id;

    return v_row;
end;
$$;

revoke all on function append_private_financing_event(
    text, text, text, text, date, text, text, text, text, text, text, text, bigint, bigint, bigint,
    bigint, bigint, bigint, bigint, text, text, text, text, bigint, bigint, bigint, bigint, text, text
) from public;
grant execute on function append_private_financing_event(
    text, text, text, text, date, text, text, text, text, text, text, text, bigint, bigint, bigint,
    bigint, bigint, bigint, bigint, text, text, text, text, bigint, bigint, bigint, bigint, text, text
) to authenticated;

-- Read-only, has_workspace_access-gated. Never blocks or auto-rejects anything -- "likely duplicate" is
-- a judgment call for the seller to review before confirming a new manual_external payment; the HARD
-- duplicate guard remains the unchanged exact-match idempotency_key unique index above.
create or replace function find_private_financing_external_payment_duplicate_candidates(
    p_owner_id text,
    p_account_id text,
    p_amount_cents bigint,
    p_effective_date date,
    p_payment_method text default null,
    p_source_reference text default null
)
returns table (
    id text,
    effective_date date,
    amount_cents bigint,
    payment_method text,
    source_reference text,
    recorded_at timestamptz
)
language plpgsql
security definer
set search_path = public
set row_security = off
stable
as $$
begin
    if auth.uid() is null then
        raise exception 'An authenticated user is required.' using errcode = '42501';
    end if;
    if not has_workspace_access(p_owner_id) then
        raise exception 'Owner does not match authenticated workspace.' using errcode = '42501';
    end if;

    return query
    select e.id, e.effective_date, e.amount_cents, e.payment_method, e.source_reference, e.recorded_at
      from public.private_financing_events e
     where e.owner_id = p_owner_id
       and e.account_id = p_account_id
       and e.event_type = 'payment_posted'
       and e.event_origin = 'manual_external'
       and (
            (p_source_reference is not null and e.source_reference = p_source_reference)
            or (
                e.amount_cents = p_amount_cents
                and (p_payment_method is null or e.payment_method = p_payment_method)
                and e.effective_date between p_effective_date - 3 and p_effective_date + 3
            )
       )
     order by e.effective_date desc;
end;
$$;

revoke all on function find_private_financing_external_payment_duplicate_candidates(text, text, bigint, date, text, text) from public;
grant execute on function find_private_financing_external_payment_duplicate_candidates(text, text, bigint, date, text, text) to authenticated;

-- Opens a financing account: inserts the account row, its version-1 component/terms rows, and its
-- account_opened ledger event, all in one transaction. property_id is intentionally absent -- see
-- Revision 3.
create or replace function open_private_financing_account(
    p_owner_id text,
    p_product text,
    p_opened_date date,
    p_late_fee_policy text,
    p_platform_fee_cents integer,
    p_fee_payer text,
    -- Required, not defaulted -- a payment-acceptance policy must always be explicitly chosen at
    -- opening; this function never silently applies a platform-wide default. See "NEW 2" above.
    p_payment_acceptance_policy text,
    p_components jsonb
)
returns private_financing_accounts
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
    v_authenticated_user uuid := auth.uid();
    v_account_id text;
    v_row public.private_financing_accounts%rowtype;
    v_origination_total bigint;
    v_distinct_component_count integer;
begin
    if v_authenticated_user is null then
        raise exception 'An authenticated user is required.' using errcode = '42501';
    end if;
    if not has_workspace_access(p_owner_id) then
        raise exception 'Owner does not match authenticated workspace.' using errcode = '42501';
    end if;
    if p_late_fee_policy = 'enabled' then
        raise exception 'late_fee_policy ''enabled'' is not yet supported: no late fee calculation is implemented.'
            using errcode = '0A000';
    end if;
    if p_payment_acceptance_policy not in ('partial_allowed', 'full_amount_or_more', 'exact_amount_only') then
        raise exception 'Unrecognized payment_acceptance_policy: %', p_payment_acceptance_policy using errcode = '22023';
    end if;
    if p_components is null or jsonb_typeof(p_components) <> 'array' or jsonb_array_length(p_components) = 0 then
        raise exception 'At least one loan component is required.' using errcode = '22023';
    end if;

    -- jsonb_to_recordset extracts by JSON key name, case-sensitively -- p_components is expected to be
    -- exactly the JS layer's own camelCase shape (privateFinancingContracts.js's
    -- validateOpeningComponent: componentType, originalPrincipalCents, rateBps, regularPaymentCents), the
    -- same object shape any real caller already has on hand, never requiring a snake_case translation
    -- step. Confirmed against a real local PostgreSQL instance during Checkpoint D live validation: an
    -- earlier draft used snake_case column aliases here, which silently extracted null for every field
    -- (jsonb_to_recordset returns null for a missing key rather than erroring) and produced a false
    -- "openingComponents must not repeat a componentType" rejection on perfectly valid input.
    select count(distinct x."componentType"), sum(x."originalPrincipalCents")
      into v_distinct_component_count, v_origination_total
      from jsonb_to_recordset(p_components) as x("componentType" text, "originalPrincipalCents" bigint, "rateBps" integer, "regularPaymentCents" bigint);
    if v_distinct_component_count <> jsonb_array_length(p_components) then
        raise exception 'openingComponents must not repeat a componentType.' using errcode = '22023';
    end if;

    v_account_id := 'pf_acct_' || gen_random_uuid()::text;

    insert into public.private_financing_accounts (
        owner_id, id, product, opened_date, origination_principal_cents,
        late_fee_policy, platform_fee_cents, fee_payer, created_by, updated_by
    ) values (
        p_owner_id, v_account_id, p_product, p_opened_date, v_origination_total,
        p_late_fee_policy, p_platform_fee_cents, p_fee_payer, v_authenticated_user::text, v_authenticated_user::text
    ) returning * into v_row;

    insert into public.private_financing_components (
        owner_id, id, account_id, component_type, version_number, original_principal_cents,
        rate_bps, regular_payment_cents, effective_date, created_by
    )
    select
        p_owner_id, 'pf_comp_' || gen_random_uuid()::text, v_account_id, x."componentType", 1,
        x."originalPrincipalCents", x."rateBps", x."regularPaymentCents", p_opened_date, v_authenticated_user::text
    from jsonb_to_recordset(p_components) as x("componentType" text, "originalPrincipalCents" bigint, "rateBps" integer, "regularPaymentCents" bigint);

    perform append_private_financing_event(
        p_owner_id := p_owner_id,
        p_account_id := v_account_id,
        p_event_type := 'account_opened',
        p_event_origin := 'interactive_user',
        p_effective_date := p_opened_date
    );

    -- Version-1 servicing policy, explicit at opening -- never a silent default. Effective immediately
    -- (now()), not backdated to p_opened_date, since a servicing policy is prospective by nature and
    -- opened_date may itself be a historical/backfilled date (e.g. a later South Main import) -- the
    -- account's online-payment policy only ever starts governing from the moment it is actually set.
    insert into public.private_financing_servicing_policy_versions (
        owner_id, id, account_id, version, payment_acceptance_policy, effective_at, acting_seller_id, reason
    ) values (
        p_owner_id, 'pf_pol_' || gen_random_uuid()::text, v_account_id, 1, p_payment_acceptance_policy,
        now(), v_authenticated_user::text, 'account_opened'
    );

    return v_row;
end;
$$;

revoke all on function open_private_financing_account(text, text, date, text, integer, text, text, jsonb) from public;
grant execute on function open_private_financing_account(text, text, date, text, integer, text, text, jsonb) to authenticated;

-- Prospective, auditable payment-acceptance-policy changes -- see "NEW 2" above for full reasoning.
-- Append-only: no INSERT/UPDATE/DELETE policy exists for the plain authenticated role on
-- private_financing_servicing_policy_versions at all; every write goes through this function (or
-- open_private_financing_account's own version-1 insert). Mirrors append_private_financing_event's own
-- attribution and allocation discipline: version is always computed here (never trusted from the caller),
-- acting_seller_id is always forced to the real authenticated human (never trusted from the caller), and
-- its only authorization check is has_workspace_access(p_owner_id) -- true for the primary owner and any
-- co-owner, never true for a claimed borrower identity or an unrelated workspace.
create or replace function append_private_financing_servicing_policy_version(
    p_owner_id text,
    p_account_id text,
    p_payment_acceptance_policy text,
    p_effective_at timestamptz,
    p_reason text default null
)
returns private_financing_servicing_policy_versions
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
    v_authenticated_user uuid := auth.uid();
    v_new_id text;
    v_next_version integer;
    v_row public.private_financing_servicing_policy_versions%rowtype;
begin
    if v_authenticated_user is null then
        raise exception 'An authenticated user is required.' using errcode = '42501';
    end if;
    if not has_workspace_access(p_owner_id) then
        raise exception 'Owner does not match authenticated workspace.' using errcode = '42501';
    end if;
    if p_payment_acceptance_policy not in ('partial_allowed', 'full_amount_or_more', 'exact_amount_only') then
        raise exception 'Unrecognized payment_acceptance_policy: %', p_payment_acceptance_policy using errcode = '22023';
    end if;
    if p_effective_at < now() then
        raise exception 'effective_at cannot be in the past: servicing policy changes are prospective only, never retroactive.'
            using errcode = '22023';
    end if;

    -- Lock the account row to serialize concurrent policy-version appends against the SAME account,
    -- exactly like append_private_financing_event's own counter lock -- different accounts never block
    -- each other.
    perform 1 from public.private_financing_accounts where owner_id = p_owner_id and id = p_account_id for update;
    if not found then
        raise exception 'Financing account was not found.' using errcode = '22023';
    end if;

    select coalesce(max(version), 0) + 1 into v_next_version
      from public.private_financing_servicing_policy_versions
     where owner_id = p_owner_id and account_id = p_account_id;

    if v_next_version > 1 and (p_reason is null or btrim(p_reason) = '') then
        raise exception 'reason is required when changing an existing servicing policy.' using errcode = '22023';
    end if;

    v_new_id := 'pf_pol_' || gen_random_uuid()::text;

    insert into public.private_financing_servicing_policy_versions (
        owner_id, id, account_id, version, payment_acceptance_policy, effective_at, acting_seller_id, reason
    ) values (
        p_owner_id, v_new_id, p_account_id, v_next_version, p_payment_acceptance_policy, p_effective_at,
        v_authenticated_user::text, p_reason
    ) returning * into v_row;

    return v_row;
end;
$$;

revoke all on function append_private_financing_servicing_policy_version(text, text, text, timestamptz, text) from public;
grant execute on function append_private_financing_servicing_policy_version(text, text, text, timestamptz, text) to authenticated;

-- Claims borrower IDENTITY rows by confirmed email (mirrors claim_rental_tenant_portal's own pattern),
-- then activates any 'invited' MEMBERSHIP rows tied to the newly-claimed identity/identities. A single
-- call can legitimately claim more than one identity row (one per owner_id the borrower has a
-- relationship with) -- unlike claim_rental_tenant_portal, ambiguity across owner_id is expected and
-- correct here (Revision 1), not an error; ambiguity WITHIN one owner_id is already structurally
-- impossible (unique index on (owner_id, lower(email))).
create or replace function claim_private_financing_borrower_portal()
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
    authenticated_user_id uuid := auth.uid();
    authenticated_email text;
    confirmed_at timestamptz;
    v_claimed_count integer;
    v_activated_count integer;
begin
    if authenticated_user_id is null then
        raise exception 'An authenticated user is required.' using errcode = '42501';
    end if;
    select lower(nullif(btrim(users.email), '')), users.email_confirmed_at
      into authenticated_email, confirmed_at from auth.users users where users.id = authenticated_user_id;
    if authenticated_email is null or confirmed_at is null then
        raise exception 'A confirmed account email is required.' using errcode = '42501';
    end if;

    update public.private_financing_borrowers
       set auth_user_id = authenticated_user_id, updated_at = now()
     where lower(email) = authenticated_email
       and (auth_user_id is null or auth_user_id = authenticated_user_id);
    get diagnostics v_claimed_count = row_count;

    update public.private_financing_account_borrowers m
       set status = 'active', activated_at = coalesce(m.activated_at, now()), updated_at = now()
      from public.private_financing_borrowers b
     where b.owner_id = m.owner_id and b.id = m.borrower_id
       and b.auth_user_id = authenticated_user_id
       and m.status = 'invited';
    get diagnostics v_activated_count = row_count;

    return jsonb_build_object('claimedIdentityCount', v_claimed_count, 'activatedMembershipCount', v_activated_count);
end;
$$;

revoke all on function claim_private_financing_borrower_portal() from public;
grant execute on function claim_private_financing_borrower_portal() to authenticated;

-- The borrower-facing ledger read boundary (Revision 2) -- see the header comment for full reasoning.
-- Verifies membership on the SPECIFIC account requested, inside the function body, before returning any
-- row; returns zero rows (never an error) when the caller has no active membership on p_account_id, so
-- existence of another seller's account can never be probed for or distinguished from "no access."
create or replace function read_private_financing_borrower_events(p_account_id text)
returns table (
    id text,
    account_id text,
    event_type text,
    event_origin text,
    source_reference text,
    ledger_sequence bigint,
    effective_date date,
    recorded_at timestamptz,
    reverses_event_id text,
    reason text,
    borrower_visible_explanation text,
    amount_cents bigint,
    interest_paid_cents bigint,
    interest_bearing_principal_paid_cents bigint,
    zero_interest_principal_paid_cents bigint,
    unallocated_cents bigint,
    principal_remaining_interest_bearing_cents bigint,
    principal_remaining_zero_interest_cents bigint,
    payment_method text,
    component_type text,
    correction_basis text,
    delta_cents bigint,
    corrected_component_principal_remaining_cents_after bigint,
    interest_bearing_delta_cents bigint,
    zero_interest_delta_cents bigint,
    closure_reason text,
    payoff_concession_event_id text
)
language plpgsql
security definer
set search_path = public
set row_security = off
stable
as $$
declare
    v_authenticated_user uuid := auth.uid();
    v_owner_id text;
begin
    if v_authenticated_user is null then
        raise exception 'An authenticated user is required.' using errcode = '42501';
    end if;
    if p_account_id is null or btrim(p_account_id) = '' then
        raise exception 'p_account_id is required.' using errcode = '22023';
    end if;

    -- Resolve owner_id ourselves from a verified active membership -- never trust a client-supplied
    -- owner_id, and never let a borrower distinguish "account doesn't exist" from "you have no access"
    -- via an error vs. empty-result side channel (both simply return zero rows below).
    select a.owner_id into v_owner_id
      from public.private_financing_accounts a
      join public.private_financing_account_borrowers m
        on m.owner_id = a.owner_id and m.account_id = a.id
      join public.private_financing_borrowers b
        on b.owner_id = m.owner_id and b.id = m.borrower_id
     where a.id = p_account_id
       and b.auth_user_id = v_authenticated_user
       and m.status = 'active';

    if v_owner_id is null then
        return;
    end if;

    return query
    select
        e.id, e.account_id, e.event_type, e.event_origin, e.source_reference,
        e.ledger_sequence, e.effective_date, e.recorded_at, e.reverses_event_id, e.reason,
        e.borrower_visible_explanation, e.amount_cents, e.interest_paid_cents,
        e.interest_bearing_principal_paid_cents, e.zero_interest_principal_paid_cents, e.unallocated_cents,
        e.principal_remaining_interest_bearing_cents, e.principal_remaining_zero_interest_cents,
        e.payment_method,
        e.component_type, e.correction_basis, e.delta_cents,
        e.corrected_component_principal_remaining_cents_after, e.interest_bearing_delta_cents,
        e.zero_interest_delta_cents, e.closure_reason, e.payoff_concession_event_id
      from public.private_financing_events e
     where e.owner_id = v_owner_id and e.account_id = p_account_id
     order by e.ledger_sequence;
end;
$$;

revoke all on function read_private_financing_borrower_events(text) from public;
grant execute on function read_private_financing_borrower_events(text) to authenticated;

-- Guarded state-machine transition for a payoff offer. SELLER-ONLY -- see Revision 6. Its only
-- authorization check is has_workspace_access(p_owner_id); there is no borrower-membership branch
-- anywhere in this function, so no borrower can ever reach it under any input.
create or replace function transition_private_financing_payoff_offer_status(
    p_owner_id text,
    p_offer_id text,
    p_new_status text,
    p_qualifying_payment_event_id text default null,
    p_qualifying_concession_event_id text default null,
    p_borrower_acceptance_method text default null,
    p_borrower_acceptance_reference text default null
)
returns private_financing_payoff_offers
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
    v_authenticated_user uuid := auth.uid();
    v_offer public.private_financing_payoff_offers%rowtype;
    v_allowed boolean := false;
begin
    if v_authenticated_user is null then
        raise exception 'An authenticated user is required.' using errcode = '42501';
    end if;
    if not has_workspace_access(p_owner_id) then
        raise exception 'Owner does not match authenticated workspace.' using errcode = '42501';
    end if;

    select * into v_offer from public.private_financing_payoff_offers where owner_id = p_owner_id and id = p_offer_id for update;
    if v_offer.id is null then
        raise exception 'Payoff offer was not found.' using errcode = '22023';
    end if;

    v_allowed := (v_offer.status = 'pending' and p_new_status in ('accepted', 'expired', 'withdrawn', 'cancelled'))
        or (v_offer.status = 'accepted' and p_new_status in ('paid', 'cancelled'));
    if not v_allowed then
        raise exception 'Cannot transition a payoff offer from % to %.', v_offer.status, p_new_status using errcode = '22023';
    end if;

    if p_new_status = 'accepted' and p_borrower_acceptance_method is null then
        raise exception 'borrower_acceptance_method is required to accept a payoff offer.' using errcode = '22023';
    end if;

    if p_new_status = 'paid' then
        if p_qualifying_payment_event_id is null then
            raise exception 'qualifying_payment_event_id is required for a paid payoff offer.' using errcode = '22023';
        end if;
        if not exists (
            select 1 from public.private_financing_events
             where owner_id = p_owner_id and id = p_qualifying_payment_event_id
               and account_id = v_offer.account_id and event_type = 'payment_posted'
        ) then
            raise exception 'qualifying_payment_event_id must reference a payment_posted event on the same account.' using errcode = '22023';
        end if;
        if p_qualifying_concession_event_id is not null and not exists (
            select 1 from public.private_financing_events
             where owner_id = p_owner_id and id = p_qualifying_concession_event_id
               and account_id = v_offer.account_id and event_type = 'payoff_concession'
        ) then
            raise exception 'qualifying_concession_event_id must reference a payoff_concession event on the same account.' using errcode = '22023';
        end if;
    end if;

    update public.private_financing_payoff_offers
       set status = p_new_status,
           borrower_accepted_at = case when p_new_status = 'accepted' then coalesce(borrower_accepted_at, now()::date) else borrower_accepted_at end,
           borrower_acceptance_method = coalesce(p_borrower_acceptance_method, borrower_acceptance_method),
           borrower_acceptance_reference = coalesce(p_borrower_acceptance_reference, borrower_acceptance_reference),
           qualifying_payment_event_id = coalesce(p_qualifying_payment_event_id, qualifying_payment_event_id),
           qualifying_concession_event_id = coalesce(p_qualifying_concession_event_id, qualifying_concession_event_id),
           updated_at = now()
     where owner_id = p_owner_id and id = p_offer_id
     returning * into v_offer;

    return v_offer;
end;
$$;

revoke all on function transition_private_financing_payoff_offer_status(text, text, text, text, text, text, text) from public;
grant execute on function transition_private_financing_payoff_offer_status(text, text, text, text, text, text, text) to authenticated;
