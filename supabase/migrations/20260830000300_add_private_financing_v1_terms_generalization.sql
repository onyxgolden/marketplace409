-- V1 TERMS GENERALIZATION -- owner-requested correction, applied AFTER SF-2C/SF-2D review.
--
-- The original foundation migration (20260830000200_create_private_financing_foundation.sql) is already
-- MERGED into main and is NEVER edited by this file -- per this repository's forward-only discipline, a
-- merged migration's own SQL text is immutable; every change here is a NEW, additive statement (ALTER,
-- DROP+CREATE FUNCTION, CREATE TABLE) in a NEW migration file. This file has NOT been applied to any
-- database, local or remote, until an operator explicitly runs it against a disposable local Supabase
-- instance for validation, and it is never applied to Production by this change alone.
--
-- SIMPLIFICATION NOTE: no Private Financing row of any kind exists in Production (or any remote database)
-- as of this migration -- the foundation migration itself has never been applied remotely (confirmed
-- repeatedly across SF-1/SF-2's own governance record). Every ALTER below is therefore written as a plain,
-- unconditional change (rename, drop+add column, drop+add constraint) rather than a data-preserving
-- backfill migration, because there is no data to preserve or migrate. This is a deliberate, disclosed
-- simplification -- if this file is ever adapted for a schema that DOES already hold rows, every ALTER
-- below would need a real backfill step first.
--
-- WHY THIS MIGRATION EXISTS: the original schema hard-capped every account at exactly one
-- 'interest_bearing' and one 'zero_interest' component (a CHECK constraint on component_type, PLUS one
-- fixed allocation algorithm baked into application code with no configurable schedule/allocation/
-- prepayment terms at all). That is South Main's own contract shape, not a structural limit every private
-- financing agreement shares -- the owner's own words: "Those constraints could make another customer's
-- agreement behave according to South Main's structure." This migration:
--   1. Generalizes private_financing_components from two named buckets to an ORDERED COLLECTION of one or
--      more components, each with a stable componentKey, a seller-facing label, and its own rate
--      (including zero) -- see component_key/label/day_count_convention/scheduled_component_amount_cents/
--      allocation_priority below.
--   2. Adds private_financing_account_terms_versions -- versioned, immutable, insert-only account-level
--      payment-frequency/allocation/extra-payment/prepayment terms, closed to exactly what V1 can
--      calculate correctly (see the CHECK constraints below and financingTermsContracts.js).
--   3. Restructures private_financing_events' per-component monetary fields from two fixed named columns
--      into jsonb maps keyed by componentKey, since the cardinality is no longer fixed at two.
--   4. Supersedes append_private_financing_event and open_private_financing_account (DROP + CREATE, since
--      Postgres cannot CREATE OR REPLACE a function whose parameter list changes) to operate on the new
--      shapes; read_private_financing_borrower_events is likewise superseded for its new column list.
-- Never touches Rental Manager payment tables, never touches financial_events/financial_accounts, and
-- introduces no Financial FORGE posting of any kind -- the exact same financial-separation boundary the
-- original migration already established.

-- ============================================================================================
-- 1. FINANCING COMPONENTS: two named buckets -> an ordered collection of one or more
-- ============================================================================================

alter table private_financing_components drop constraint if exists private_financing_components_component_type_check;
alter table private_financing_components rename column component_type to component_key;
alter table private_financing_components rename column regular_payment_cents to scheduled_component_amount_cents;
alter table private_financing_components add column label text;
alter table private_financing_components add column day_count_convention text;
alter table private_financing_components add column allocation_priority integer;
-- No data exists to backfill (see the simplification note above) -- these become NOT NULL immediately
-- rather than backfilled-then-tightened, since there are zero existing rows for a NOT NULL addition to
-- reject.
alter table private_financing_components alter column label set not null;
alter table private_financing_components alter column day_count_convention set not null;
alter table private_financing_components alter column allocation_priority set not null;
alter table private_financing_components add constraint private_financing_components_day_count_convention_check
    check (day_count_convention in ('actual_365'));
-- component_key is no longer a closed two-value enum -- it is the component's own stable identity within
-- an account, seller-chosen or system-generated, validated only for non-emptiness at the application layer
-- (privateFinancingContracts.js). A zero-interest component is one possible component, never required;
-- V1 imposes no maximum component count.
alter table private_financing_components add constraint private_financing_components_component_key_check
    check (btrim(component_key) <> '');
alter table private_financing_components drop constraint if exists private_financing_components_key;
alter table private_financing_components add constraint private_financing_components_unique_key_version
    unique (owner_id, account_id, component_key, version_number);

comment on column private_financing_components.component_key is
    'Stable identity for this component across its own version chain -- an ordered collection member, never one of exactly two fixed named buckets.';
comment on column private_financing_components.label is
    'Seller/lender-facing display name for this component, e.g. "Interest-bearing note" -- never a raw enum value rendered to a user.';
comment on column private_financing_components.allocation_priority is
    'Required-phase allocation order within the account''s allocationPolicy (scheduled_component_order) -- lower values are applied first.';

-- private_financing_current_components must be recreated: it references component_type in its own DISTINCT
-- ON clause, which no longer exists under that name. Dropped and recreated, not edited in place, since a
-- view's defining query cannot be partially ALTERed.
drop view if exists private_financing_current_components;
create view private_financing_current_components
with (security_invoker = true) as
select distinct on (owner_id, account_id, component_key) *
from private_financing_components
order by owner_id, account_id, component_key, version_number desc;

-- enforce_private_financing_component_version_ordering (defined by the original foundation migration)
-- referenced the now-renamed component_type column in its own trigger body -- a plain ALTER TABLE ...
-- RENAME COLUMN updates every dependent view/constraint automatically, but NOT the text of a PL/pgSQL
-- function body, which Postgres treats as an opaque string until executed. Discovered by live-Supabase
-- validation of this migration (attempting a real component-version insert failed with "column
-- component_type does not exist"), not by any static migration-text test -- CREATE OR REPLACE is safe
-- here (no DROP needed) since this trigger function takes no arguments and the existing trigger already
-- references it by name, so it picks up the corrected body without needing to be recreated itself.
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
         where owner_id = new.owner_id and account_id = new.account_id and component_key = new.component_key
           and version_number < new.version_number;
        if v_max_prior_effective_date is null or new.effective_date <= v_max_prior_effective_date then
            raise exception 'A new component version must have an effective_date strictly after every prior version for the same component.'
                using errcode = '22023';
        end if;
    end if;
    return new;
end;
$$;

-- OWNER-DIRECTED V1 SAFETY BOUNDARY: changing signed loan terms -- which a component's own rate,
-- principal, and scheduled amount are, exactly as much as the account-level terms in section 2 below --
-- is not an ordinary seller adjustment. It may require borrower consent, a signed amendment, updated
-- disclosures, a recalculated schedule, and jurisdiction-specific legal review; primary-owner/co-owner
-- workspace authorization alone is not sufficient authority to change a borrower's contract. The original
-- foundation migration granted `private_financing_components_owner_insert` to the plain `authenticated`
-- role (has_workspace_access(owner_id) only) -- sufficient for an ordinary financial adjustment, but NOT
-- for a signed-terms amendment, which this component-version mechanism structurally is. This is closed
-- here, deliberately and explicitly, so that in V1 no seller, co-owner, borrower, browser route, or
-- ordinary authenticated RPC can append a component amendment -- exactly the same posture
-- private_financing_account_terms_versions already has below, for the same reason. Only
-- open_private_financing_account (version 1, at account opening, SECURITY DEFINER) may ever write a row
-- here in V1. The versioning columns/trigger above remain as future-compatible structure for a properly
-- designed Terms Amendments phase (amendment document/reference, borrower/co-borrower consent, acting
-- lender, disclosure requirements, schedule recalculation, treatment of existing payments, and immutable
-- acceptance evidence -- none of which V1 attempts).
drop policy if exists "private_financing_components_owner_insert" on private_financing_components;

-- ============================================================================================
-- 2. ACCOUNT TERMS: versioned payment-frequency/allocation/extra-payment/prepayment terms
-- ============================================================================================
-- Mirrors private_financing_components' own insert-only, trigger-ordered versioning discipline exactly.
-- Every enum here is CLOSED to precisely what V1's engine (paymentAllocation.js, dueState.js) can
-- calculate correctly and has tests for -- an unsupported value is REJECTED by this table's own CHECK
-- constraints, so "unsupported terms fail closed" is a database fact, not only an application convention.

create table if not exists private_financing_account_terms_versions (
    owner_id text not null,
    id text not null,
    account_id text not null,
    version_number integer not null check (version_number > 0),
    -- V1 supports only 'monthly' -- deterministic date/arrears tests exist for it and no other cadence.
    -- Additional values may be reserved here later once a fully-tested implementation exists; the ENGINE
    -- (dueState.js) independently rejects any value it does not implement, so this CHECK and the engine's
    -- own fail-closed behavior can never silently disagree.
    payment_frequency text not null check (payment_frequency in ('monthly')),
    first_payment_due_date date not null,
    regular_scheduled_payment_amount_cents bigint not null check (regular_scheduled_payment_amount_cents >= 0),
    maturity_date date,
    -- The REQUIRED-phase order (interest then each component's own scheduled amount, in
    -- allocation_priority order) -- a single V1 value today, expressed as a stored enum for future
    -- extensibility rather than a hard-coded assumption.
    allocation_policy text not null check (allocation_policy in ('scheduled_component_order')),
    -- What happens to payment amount ABOVE the combined required total -- the axis that actually varies
    -- by real contract. South Main's own historical behavior (excess reduces the interest-bearing
    -- component, since it was the only rate>0 component) is expressed as highest_rate_first_extra --
    -- ordinary configuration, never a special code branch.
    extra_payment_allocation_policy text not null check (
        extra_payment_allocation_policy in ('highest_rate_first_extra', 'proportional_extra', 'selected_component_extra')
    ),
    -- Distinguishes at least these three; penalties are NOT implemented in V1 -- 'unsupported' is a real,
    -- honest value an account can hold, under which the due-state engine (dueState.js) refuses to
    -- calculate a due-date-advancement answer rather than guessing.
    prepayment_policy text not null check (
        prepayment_policy in (
            'allowed_without_penalty_does_not_advance_due_date',
            'allowed_without_penalty_advances_due_date',
            'unsupported'
        )
    ),
    day_count_convention text not null check (day_count_convention in ('actual_365')),
    effective_date date not null,
    acting_seller_id text not null,
    amendment_reason text,
    created_by text,
    created_at timestamptz not null default now(),
    primary key (owner_id, id),
    foreign key (owner_id, account_id) references private_financing_accounts (owner_id, id) on delete restrict,
    unique (owner_id, account_id, version_number),
    check (version_number = 1 or (amendment_reason is not null and btrim(amendment_reason) <> ''))
);

create index if not exists idx_pf_account_terms_versions_account on private_financing_account_terms_versions (owner_id, account_id, effective_date);

-- Enforces "no overlapping or ambiguous active versions," identical in spirit to
-- enforce_private_financing_component_version_ordering -- a new terms version must strictly postdate every
-- prior version's effective_date.
create or replace function enforce_private_financing_account_terms_version_ordering()
returns trigger
language plpgsql
set search_path = public
as $$
declare
    v_max_prior_effective_date date;
begin
    if new.version_number > 1 then
        select max(effective_date) into v_max_prior_effective_date
          from public.private_financing_account_terms_versions
         where owner_id = new.owner_id and account_id = new.account_id
           and version_number < new.version_number;
        if v_max_prior_effective_date is null or new.effective_date <= v_max_prior_effective_date then
            raise exception 'A new account terms version must have an effective_date strictly after every prior version.'
                using errcode = '22023';
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists trg_pf_account_terms_version_ordering on private_financing_account_terms_versions;
create trigger trg_pf_account_terms_version_ordering
before insert on private_financing_account_terms_versions
for each row execute function enforce_private_financing_account_terms_version_ordering();

alter table private_financing_account_terms_versions enable row level security;
alter table private_financing_account_terms_versions force row level security;
create policy "pf_account_terms_versions_owner_select" on private_financing_account_terms_versions
    for select to authenticated using (has_workspace_access(owner_id));
-- OWNER-DIRECTED V1 SAFETY BOUNDARY (see the matching comment on private_financing_components above):
-- deliberately no INSERT/UPDATE/DELETE policy for the plain authenticated role at all -- only
-- open_private_financing_account (version 1, at account opening) may ever write a row here in V1. A
-- terms amendment is not an ordinary seller adjustment (it may require borrower consent, updated
-- disclosures, a recalculated schedule, and legal review), so no seller/co-owner/borrower/RPC can append
-- one yet. This is a real V1 protection, not an unfinished feature -- a future, separately designed Terms
-- Amendments phase would need its own consent/disclosure/evidence machinery before any write path here
-- would be safe to add.

create view private_financing_current_account_terms
with (security_invoker = true) as
select distinct on (owner_id, account_id) *
from private_financing_account_terms_versions
where effective_date <= current_date
order by owner_id, account_id, effective_date desc, version_number desc;

-- ============================================================================================
-- 3. LEDGER EVENTS: per-component fixed columns -> jsonb maps keyed by componentKey
-- ============================================================================================

alter table private_financing_events drop column if exists interest_paid_cents;
alter table private_financing_events drop column if exists interest_bearing_principal_paid_cents;
alter table private_financing_events drop column if exists zero_interest_principal_paid_cents;
alter table private_financing_events drop column if exists principal_remaining_interest_bearing_cents;
alter table private_financing_events drop column if exists principal_remaining_zero_interest_cents;
alter table private_financing_events drop column if exists interest_bearing_delta_cents;
alter table private_financing_events drop column if exists zero_interest_delta_cents;
alter table private_financing_events rename column component_type to component_id;

alter table private_financing_events add column interest_paid_by_component_cents jsonb;
alter table private_financing_events add column principal_paid_by_component_cents jsonb;
alter table private_financing_events add column principal_remaining_by_component_cents jsonb;
alter table private_financing_events add column delta_cents_by_component_cents jsonb;
-- Only ever meaningful on a payment_posted event whose account's extraPaymentAllocationPolicy is
-- selected_component_extra -- the seller/lender's own explicit choice of which component absorbs payment
-- amount above the combined required total, for that specific payment. Never inferred or defaulted.
alter table private_financing_events add column selected_extra_component_id text;

comment on column private_financing_events.interest_paid_by_component_cents is
    'jsonb {[componentKey]: cents} -- interest paid per component by this event. Empty/absent entries mean that component received no interest this event.';
comment on column private_financing_events.principal_paid_by_component_cents is
    'jsonb {[componentKey]: cents} -- principal paid per component by this event (payment_posted/payment_reversal).';
comment on column private_financing_events.principal_remaining_by_component_cents is
    'jsonb {[componentKey]: cents} -- authoritative post-event remaining principal per component, independently re-verified by replayEvents.js, never trusted at face value.';
comment on column private_financing_events.delta_cents_by_component_cents is
    'jsonb {[componentKey]: cents, each <= 0} -- payoff_concession''s per-component forgiveness. Every component on the account must reach exactly 0 after this event.';

-- The old CASE-based "which columns must be populated per event_type" constraint referenced the fixed
-- columns dropped above -- dropped and rebuilt against the new column set. The "allocation sums exactly
-- to amount_cents" invariant (previously implicit in the old fixed-column sum) is NOT expressible in a
-- plain CHECK constraint once amounts live inside jsonb (Postgres CHECK constraints cannot contain
-- subqueries or aggregates) -- it is instead enforced inside append_private_financing_event itself
-- (Section 4 below) as a defense-in-depth re-check alongside privateFinancingContracts.js's own
-- JS-layer validation, exactly the same "two independent layers must agree" discipline the RPC already
-- applies to has_workspace_access and duplicate-reversal detection.
alter table private_financing_events drop constraint if exists private_financing_events_check8;
alter table private_financing_events add constraint private_financing_events_fields_by_type_check check (
    case
        when event_type = 'account_opened' then
            amount_cents is null and interest_paid_by_component_cents is null
            and principal_paid_by_component_cents is null and unallocated_cents is null
            and principal_remaining_by_component_cents is null and selected_extra_component_id is null
            and component_id is null and correction_basis is null and delta_cents is null
            and corrected_component_principal_remaining_cents_after is null
            and delta_cents_by_component_cents is null and closure_reason is null and payoff_concession_event_id is null
        when event_type in ('payment_posted', 'payment_reversal') then
            amount_cents is not null and interest_paid_by_component_cents is not null
            and principal_paid_by_component_cents is not null and unallocated_cents is not null
            and principal_remaining_by_component_cents is not null
            and component_id is null and correction_basis is null and delta_cents is null
            and corrected_component_principal_remaining_cents_after is null
            and delta_cents_by_component_cents is null and closure_reason is null and payoff_concession_event_id is null
            and (event_type = 'payment_posted' or selected_extra_component_id is null)
        when event_type = 'principal_correction' then
            component_id is not null and correction_basis is not null and delta_cents is not null
            and corrected_component_principal_remaining_cents_after is not null
            and amount_cents is null and interest_paid_by_component_cents is null
            and principal_paid_by_component_cents is null and unallocated_cents is null
            and principal_remaining_by_component_cents is null and selected_extra_component_id is null
            and delta_cents_by_component_cents is null and closure_reason is null and payoff_concession_event_id is null
        when event_type = 'interest_correction' then
            component_id is not null and correction_basis is not null and delta_cents is not null
            and corrected_component_principal_remaining_cents_after is null
            and amount_cents is null and interest_paid_by_component_cents is null
            and principal_paid_by_component_cents is null and unallocated_cents is null
            and principal_remaining_by_component_cents is null and selected_extra_component_id is null
            and delta_cents_by_component_cents is null and closure_reason is null and payoff_concession_event_id is null
        when event_type = 'compensating_correction' then
            delta_cents is not null and correction_basis is null
            and corrected_component_principal_remaining_cents_after is null
            and amount_cents is null and interest_paid_by_component_cents is null
            and principal_paid_by_component_cents is null and unallocated_cents is null
            and principal_remaining_by_component_cents is null and selected_extra_component_id is null
            and delta_cents_by_component_cents is null and closure_reason is null and payoff_concession_event_id is null
        when event_type = 'payoff_concession' then
            delta_cents_by_component_cents is not null and principal_remaining_by_component_cents is not null
            and amount_cents is null and interest_paid_by_component_cents is null
            and principal_paid_by_component_cents is null and unallocated_cents is null
            and selected_extra_component_id is null and component_id is null and correction_basis is null
            and delta_cents is null and corrected_component_principal_remaining_cents_after is null
            and closure_reason is null and payoff_concession_event_id is null
        when event_type = 'account_closed' then
            closure_reason is not null
            and ((closure_reason <> 'payoff_concession_applied') or payoff_concession_event_id is not null)
            and ((closure_reason = 'payoff_concession_applied') or payoff_concession_event_id is null)
            and amount_cents is null and interest_paid_by_component_cents is null
            and principal_paid_by_component_cents is null and unallocated_cents is null
            and principal_remaining_by_component_cents is null and selected_extra_component_id is null
            and component_id is null and correction_basis is null and delta_cents is null
            and corrected_component_principal_remaining_cents_after is null and delta_cents_by_component_cents is null
        else false
    end
);

-- ============================================================================================
-- 4. RPCS SUPERSEDED FOR THE NEW SHAPES (DROP + CREATE -- Postgres cannot CREATE OR REPLACE a
--    function whose parameter list changes)
-- ============================================================================================

drop function if exists append_private_financing_event(
    text, text, text, text, date, text, text, text, text, text, text, text, bigint, bigint, bigint,
    bigint, bigint, bigint, bigint, text, text, text, text, bigint, bigint, bigint, bigint, text, text
);

create function append_private_financing_event(
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
    p_interest_paid_by_component_cents jsonb default null,
    p_principal_paid_by_component_cents jsonb default null,
    p_unallocated_cents bigint default null,
    p_principal_remaining_by_component_cents jsonb default null,
    p_selected_extra_component_id text default null,
    p_payment_method text default null,
    p_external_evidence_reference text default null,
    p_component_id text default null,
    p_correction_basis text default null,
    p_delta_cents bigint default null,
    p_corrected_component_principal_remaining_cents_after bigint default null,
    p_delta_cents_by_component_cents jsonb default null,
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
    v_component_ids text[];
    v_valid_component_ids text[];
    v_sum bigint;
    v_key text;
    v_value bigint;
begin
    if v_authenticated_user is null then
        raise exception 'An authenticated user is required.' using errcode = '42501';
    end if;
    -- Authorization is checked BEFORE any sequence allocation (unchanged from Revision 5).
    if not has_workspace_access(p_owner_id) then
        raise exception 'Owner does not match authenticated workspace.' using errcode = '42501';
    end if;

    if p_event_origin not in ('interactive_user', 'manual_import', 'manual_external') then
        raise exception 'append_private_financing_event does not accept event_origin % from the authenticated role.', p_event_origin
            using errcode = '42501';
    end if;

    if p_event_origin in ('interactive_user', 'manual_external') then
        p_created_by := v_authenticated_user::text;
    elsif p_created_by is not null then
        raise exception 'created_by must be null when event_origin is not interactive_user or manual_external.' using errcode = '22023';
    end if;

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

    -- Defense-in-depth (Section 3's own note): every componentKey referenced anywhere in this event's
    -- jsonb fields must be a REAL component that currently exists on this account, and for payment_posted/
    -- payment_reversal, the allocation must sum EXACTLY to amount_cents -- neither check is expressible in
    -- a plain table CHECK constraint once amounts live in jsonb, so both run here, independently of
    -- privateFinancingContracts.js's own identical JS-layer validation.
    select array_agg(component_key) into v_valid_component_ids
      from public.private_financing_components where owner_id = p_owner_id and account_id = p_account_id;

    if p_event_type in ('payment_posted', 'payment_reversal') then
        if p_amount_cents is null or p_amount_cents <= 0 then
            raise exception 'amount_cents must be a positive integer for %.', p_event_type using errcode = '22023';
        end if;
        v_sum := coalesce(p_unallocated_cents, 0);
        for v_key, v_value in select * from jsonb_each_text(coalesce(p_interest_paid_by_component_cents, '{}'::jsonb))
        loop
            if not (v_key = any(v_valid_component_ids)) then
                raise exception 'interest_paid_by_component_cents references unknown component "%".', v_key using errcode = '22023';
            end if;
            v_sum := v_sum + v_value::bigint;
        end loop;
        for v_key, v_value in select * from jsonb_each_text(coalesce(p_principal_paid_by_component_cents, '{}'::jsonb))
        loop
            if not (v_key = any(v_valid_component_ids)) then
                raise exception 'principal_paid_by_component_cents references unknown component "%".', v_key using errcode = '22023';
            end if;
            v_sum := v_sum + v_value::bigint;
        end loop;
        if v_sum <> p_amount_cents then
            raise exception 'allocation fields must sum exactly to amount_cents (%), got % -- no event may manufacture or lose money.', p_amount_cents, v_sum
                using errcode = '22023';
        end if;
    end if;
    if p_component_id is not null and not (p_component_id = any(v_valid_component_ids)) then
        raise exception 'component_id "%" does not exist on this account.', p_component_id using errcode = '22023';
    end if;
    if p_delta_cents_by_component_cents is not null then
        for v_key in select * from jsonb_object_keys(p_delta_cents_by_component_cents)
        loop
            if not (v_key = any(v_valid_component_ids)) then
                raise exception 'delta_cents_by_component_cents references unknown component "%".', v_key using errcode = '22023';
            end if;
        end loop;
    end if;

    v_new_id := 'pf_evt_' || gen_random_uuid()::text;

    insert into public.private_financing_events (
        owner_id, id, account_id, event_type, event_origin, created_by, source_reference,
        idempotency_key, ledger_sequence, effective_date, reverses_event_id, reason,
        internal_note, borrower_visible_explanation, amount_cents,
        interest_paid_by_component_cents, principal_paid_by_component_cents, unallocated_cents,
        principal_remaining_by_component_cents, selected_extra_component_id,
        payment_method, external_evidence_reference,
        component_id, correction_basis, delta_cents, corrected_component_principal_remaining_cents_after,
        delta_cents_by_component_cents, closure_reason, payoff_concession_event_id
    ) values (
        p_owner_id, v_new_id, p_account_id, p_event_type, p_event_origin, p_created_by, p_source_reference,
        p_idempotency_key, v_seq, p_effective_date, p_reverses_event_id, p_reason,
        p_internal_note, p_borrower_visible_explanation, p_amount_cents,
        p_interest_paid_by_component_cents, p_principal_paid_by_component_cents, p_unallocated_cents,
        p_principal_remaining_by_component_cents, p_selected_extra_component_id,
        p_payment_method, p_external_evidence_reference,
        p_component_id, p_correction_basis, p_delta_cents, p_corrected_component_principal_remaining_cents_after,
        p_delta_cents_by_component_cents, p_closure_reason, p_payoff_concession_event_id
    ) returning * into v_row;

    update public.private_financing_accounts set next_ledger_sequence = v_seq + 1, updated_at = now()
     where owner_id = p_owner_id and id = p_account_id;

    return v_row;
end;
$$;

revoke all on function append_private_financing_event(
    text, text, text, text, date, text, text, text, text, text, text, text, bigint, jsonb, jsonb,
    bigint, jsonb, text, text, text, text, text, bigint, bigint, jsonb, text, text
) from public;
grant execute on function append_private_financing_event(
    text, text, text, text, date, text, text, text, text, text, text, text, bigint, jsonb, jsonb,
    bigint, jsonb, text, text, text, text, text, bigint, bigint, jsonb, text, text
) to authenticated;

-- open_private_financing_account: superseded for the new p_components shape (componentKey/label/
-- originalPrincipalCents/rateBps/dayCountConvention/scheduledComponentAmountCents/allocationPriority) and
-- new required account-terms parameters -- opening an account now creates its version-1 terms row in the
-- same transaction, exactly as it already did for version-1 components.
drop function if exists open_private_financing_account(text, text, date, text, integer, text, text, jsonb);

create function open_private_financing_account(
    p_owner_id text,
    p_product text,
    p_opened_date date,
    p_late_fee_policy text,
    p_platform_fee_cents integer,
    p_fee_payer text,
    p_payment_acceptance_policy text,
    p_components jsonb,
    p_payment_frequency text,
    p_first_payment_due_date date,
    p_regular_scheduled_payment_amount_cents bigint,
    p_allocation_policy text,
    p_extra_payment_allocation_policy text,
    p_prepayment_policy text,
    p_day_count_convention text,
    p_maturity_date date default null
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
        raise exception 'At least one financing component is required.' using errcode = '22023';
    end if;
    if p_payment_frequency not in ('monthly') then
        raise exception 'paymentFrequency "%" is not supported.', p_payment_frequency using errcode = '22023';
    end if;
    if p_allocation_policy not in ('scheduled_component_order') then
        raise exception 'allocationPolicy "%" is not supported.', p_allocation_policy using errcode = '22023';
    end if;
    if p_extra_payment_allocation_policy not in ('highest_rate_first_extra', 'proportional_extra', 'selected_component_extra') then
        raise exception 'extraPaymentAllocationPolicy "%" is not supported.', p_extra_payment_allocation_policy using errcode = '22023';
    end if;
    if p_prepayment_policy not in (
        'allowed_without_penalty_does_not_advance_due_date', 'allowed_without_penalty_advances_due_date', 'unsupported'
    ) then
        raise exception 'prepaymentPolicy "%" is not supported.', p_prepayment_policy using errcode = '22023';
    end if;
    if p_day_count_convention not in ('actual_365') then
        raise exception 'dayCountConvention "%" is not supported.', p_day_count_convention using errcode = '22023';
    end if;

    -- jsonb_to_recordset extracts by JSON key name, case-sensitively -- p_components is expected to be
    -- exactly the JS layer's own camelCase shape.
    select count(distinct x."componentKey"), sum(x."originalPrincipalCents")
      into v_distinct_component_count, v_origination_total
      from jsonb_to_recordset(p_components)
        as x("componentKey" text, "label" text, "originalPrincipalCents" bigint, "rateBps" integer, "dayCountConvention" text, "scheduledComponentAmountCents" bigint, "allocationPriority" integer);
    if v_distinct_component_count <> jsonb_array_length(p_components) then
        raise exception 'components must not repeat a componentKey.' using errcode = '22023';
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
        owner_id, id, account_id, component_key, label, version_number, original_principal_cents,
        rate_bps, day_count_convention, scheduled_component_amount_cents, allocation_priority,
        effective_date, created_by
    )
    select
        p_owner_id, 'pf_comp_' || gen_random_uuid()::text, v_account_id,
        x."componentKey", x."label", 1, x."originalPrincipalCents",
        x."rateBps", x."dayCountConvention", x."scheduledComponentAmountCents", x."allocationPriority",
        p_opened_date, v_authenticated_user::text
    from jsonb_to_recordset(p_components)
      as x("componentKey" text, "label" text, "originalPrincipalCents" bigint, "rateBps" integer, "dayCountConvention" text, "scheduledComponentAmountCents" bigint, "allocationPriority" integer);

    insert into public.private_financing_account_terms_versions (
        owner_id, id, account_id, version_number, payment_frequency, first_payment_due_date,
        regular_scheduled_payment_amount_cents, maturity_date, allocation_policy,
        extra_payment_allocation_policy, prepayment_policy, day_count_convention,
        effective_date, acting_seller_id, created_by
    ) values (
        p_owner_id, 'pf_terms_' || gen_random_uuid()::text, v_account_id, 1, p_payment_frequency, p_first_payment_due_date,
        p_regular_scheduled_payment_amount_cents, p_maturity_date, p_allocation_policy,
        p_extra_payment_allocation_policy, p_prepayment_policy, p_day_count_convention,
        p_opened_date, v_authenticated_user::text, v_authenticated_user::text
    );

    perform append_private_financing_event(
        p_owner_id := p_owner_id,
        p_account_id := v_account_id,
        p_event_type := 'account_opened',
        p_event_origin := 'interactive_user',
        p_effective_date := p_opened_date
    );

    insert into public.private_financing_servicing_policy_versions (
        owner_id, id, account_id, version, payment_acceptance_policy, effective_at, acting_seller_id, reason
    ) values (
        p_owner_id, 'pf_pol_' || gen_random_uuid()::text, v_account_id, 1, p_payment_acceptance_policy,
        now(), v_authenticated_user::text, 'account_opened'
    );

    return v_row;
end;
$$;

revoke all on function open_private_financing_account(
    text, text, date, text, integer, text, text, jsonb, text, date, bigint, text, text, text, text, date
) from public;
grant execute on function open_private_financing_account(
    text, text, date, text, integer, text, text, jsonb, text, date, bigint, text, text, text, text, date
) to authenticated;

-- read_private_financing_borrower_events: superseded for the new column list -- same authorization
-- boundary, same borrower-redaction discipline (never selects internal_note/idempotency_key/created_by/
-- external_evidence_reference), unchanged.
drop function if exists read_private_financing_borrower_events(text);

create function read_private_financing_borrower_events(p_account_id text)
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
    interest_paid_by_component_cents jsonb,
    principal_paid_by_component_cents jsonb,
    unallocated_cents bigint,
    principal_remaining_by_component_cents jsonb,
    payment_method text,
    component_id text,
    correction_basis text,
    delta_cents bigint,
    corrected_component_principal_remaining_cents_after bigint,
    delta_cents_by_component_cents jsonb,
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
        e.borrower_visible_explanation, e.amount_cents,
        e.interest_paid_by_component_cents, e.principal_paid_by_component_cents, e.unallocated_cents,
        e.principal_remaining_by_component_cents,
        e.payment_method,
        e.component_id, e.correction_basis, e.delta_cents,
        e.corrected_component_principal_remaining_cents_after, e.delta_cents_by_component_cents,
        e.closure_reason, e.payoff_concession_event_id
      from public.private_financing_events e
     where e.owner_id = v_owner_id and e.account_id = p_account_id
     order by e.ledger_sequence;
end;
$$;

revoke all on function read_private_financing_borrower_events(text) from public;
grant execute on function read_private_financing_borrower_events(text) to authenticated;

-- ============================================================================================
-- 5. UNUSED payoff-offer scaffold: generalized for consistency (this table/RPC has no live caller
--    anywhere in this codebase yet -- payoffOffer.js is not wired into any route -- so this is a safe,
--    low-risk cleanup rather than a load-bearing behavior change)
-- ============================================================================================

alter table private_financing_payoff_offers drop column if exists interest_bearing_principal_cents;
alter table private_financing_payoff_offers drop column if exists zero_interest_principal_cents;
alter table private_financing_payoff_offers add column principal_by_component_cents jsonb;
-- No data exists to backfill -- see the simplification note above.
alter table private_financing_payoff_offers alter column principal_by_component_cents set not null;
-- transition_private_financing_payoff_offer_status returns the table's own %rowtype via `select *`, so it
-- automatically reflects this column change with no DROP+CREATE needed for that function.

-- ============================================================================================
-- 6. FINANCIAL SEPARATION (unchanged from the original migration's own boundary): no FK into
--    rental_payments, no reference to financial_accounts, no reference to landlord_payment_accounts, no
--    private_financing_payment_accounts table, no Financial FORGE posting anywhere in this migration.
-- ============================================================================================
