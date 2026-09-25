-- Tenant overpayment credits (2026-09-25).
--
-- Problem: an offline (cash/cashier's check) payment that exceeds the selected charge's
-- remaining balance was rejected outright, leaving no honest way to record an overpayment
-- (e.g. tenant pays $1,532 cash against a $1,500 September charge — the $32 excess had
-- nowhere to live in the ledger).
--
-- Mechanism: with explicit owner confirmation, the excess becomes an open credit on the
-- tenant's lease. Credits auto-apply (FIFO) to the next generated charge for the same
-- lease, or can be applied manually to a specific open charge. Every dollar stays
-- traceable: payment row (full received amount) -> credit row (excess) -> application
-- rows (credit -> charge). Credit creation and application are balance-neutral memo
-- movements in the ledger read model — the money is counted exactly once, in the
-- payment — while the charge's paid_amount_cents reflects applied credits so remaining
-- balances (owner dashboard, tenant portal) stay correct.
--
-- Reversibility: a credit's unapplied remainder can be voided with a reason (voided_at /
-- voided_by / void_reason are explicit audit columns); applications already consumed by
-- a charge are immutable history (the money was really applied).
--
-- Security model: the credit tables are SELECT-only for every caller role (owner and
-- tenant SELECT policies; no INSERT/UPDATE/DELETE grants). All mutations go through the
-- SECURITY DEFINER RPCs below — each with a fixed search_path, the has_workspace_access
-- check first, EXECUTE granted to authenticated only (revoked from public/anon), and
-- audit columns sourced from auth.uid() per the 20260829 attribution contract. An
-- immutability trigger rejects any UPDATE/DELETE on application rows. The 20260912
-- explicit-grant contract is honored: table grants are positive and minimal (SELECT to
-- authenticated), and no DELETE is granted on any payment/ledger table.

create table if not exists rental_tenant_credits (
  owner_id text not null,
  id text primary key,
  tenant_id text not null,
  lease_id text not null,
  amount_cents bigint not null check (amount_cents > 0),
  remaining_cents bigint not null check (remaining_cents >= 0),
  source text not null default 'overpayment' check (source in ('overpayment')),
  -- Every credit is born from a recorded payment: the receipt is the audit anchor.
  -- NOT NULL (not merely a partial unique index) so no credit can ever exist without
  -- its source payment.
  source_payment_id text not null,
  status text not null default 'open' check (status in ('open', 'fully_applied', 'void')),
  notes text,
  voided_at timestamptz,
  voided_by text,
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (remaining_cents <= amount_cents),
  check (status <> 'void' or (voided_at is not null and void_reason is not null)),
  foreign key (owner_id, source_payment_id) references rental_payments(owner_id, id) on delete restrict,
  foreign key (owner_id, lease_id) references rental_leases(owner_id, id) on delete restrict,
  foreign key (owner_id, tenant_id) references rental_tenants(owner_id, id) on delete restrict
);
create index if not exists idx_rental_tenant_credits_owner_tenant
  on rental_tenant_credits(owner_id, tenant_id);
create index if not exists idx_rental_tenant_credits_owner_lease_open
  on rental_tenant_credits(owner_id, lease_id) where status = 'open';
-- One payment produces at most one credit: the excess is computed once per recording.
-- Plain unique index (source_payment_id is NOT NULL, so no partial condition needed).
create unique index if not exists uq_rental_tenant_credits_owner_source_payment
  on rental_tenant_credits(owner_id, source_payment_id);

create table if not exists rental_credit_applications (
  owner_id text not null,
  id text primary key,
  credit_id text not null,
  tenant_id text not null,
  lease_id text not null,
  charge_id text not null,
  amount_cents bigint not null check (amount_cents > 0),
  applied_at timestamptz not null default now(),
  applied_by text,
  notes text,
  foreign key (owner_id, credit_id) references rental_tenant_credits(owner_id, id) on delete restrict,
  foreign key (owner_id, charge_id) references rent_charges(owner_id, id) on delete restrict,
  foreign key (owner_id, lease_id) references rental_leases(owner_id, id) on delete restrict,
  foreign key (owner_id, tenant_id) references rental_tenants(owner_id, id) on delete restrict
);
create index if not exists idx_rental_credit_applications_owner_credit
  on rental_credit_applications(owner_id, credit_id);
create index if not exists idx_rental_credit_applications_owner_charge
  on rental_credit_applications(owner_id, charge_id);

-- Row-level security: SELECT-only for everyone.
--
-- Credit tables are append-only financial history. No authenticated caller may insert,
-- update, or delete rows directly — all mutations go through the SECURITY DEFINER RPCs
-- below, which enforce the workspace check, FIFO/application invariants, and audit
-- attribution. (Deliberately NOT `force row level security`: the definer RPCs run as the
-- table owner and must bypass RLS; authenticated callers are still policy-bound.)
-- Application rows are additionally protected by an immutability trigger: the money an
-- application moved is real history and can never be rewritten.
alter table rental_tenant_credits enable row level security;
alter table rental_credit_applications enable row level security;

drop policy if exists "rental_tenant_credits_owner_select" on rental_tenant_credits;
create policy "rental_tenant_credits_owner_select" on rental_tenant_credits for select to authenticated
  using (has_workspace_access(owner_id));
drop policy if exists "rental_tenant_credits_tenant_select" on rental_tenant_credits;
create policy "rental_tenant_credits_tenant_select" on rental_tenant_credits for select to authenticated
  using (rental_actor_has_lease_access(owner_id, lease_id));
drop policy if exists "rental_credit_applications_owner_select" on rental_credit_applications;
create policy "rental_credit_applications_owner_select" on rental_credit_applications for select to authenticated
  using (has_workspace_access(owner_id));
drop policy if exists "rental_credit_applications_tenant_select" on rental_credit_applications;
create policy "rental_credit_applications_tenant_select" on rental_credit_applications for select to authenticated
  using (rental_actor_has_lease_access(owner_id, lease_id));

-- Table-level grants (the 20260912 explicit-grant contract pattern): authenticated callers
-- read these tables through the API/portal SELECTs above; every write path is a definer
-- RPC. No INSERT/UPDATE/DELETE is granted to any caller role — mirroring the contract's
-- "no DELETE on any payment/ledger table" rule, extended to all direct writes here.
revoke all on table rental_tenant_credits from public, anon;
revoke all on table rental_credit_applications from public, anon;
grant select on table rental_tenant_credits to authenticated;
grant select on table rental_credit_applications to authenticated;

-- Credit applications are immutable history: once an application row records that credit
-- money moved onto a charge, no UPDATE or DELETE may ever alter it — not even by the
-- owner. (The RPCs only ever INSERT application rows, so this trigger cannot break them.)
create or replace function _block_rental_credit_application_mutation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  raise exception 'Credit applications are immutable history. Void the credit remainder instead.';
end;
$$;
revoke all on function _block_rental_credit_application_mutation() from public, anon;
drop trigger if exists trg_rental_credit_applications_immutable on rental_credit_applications;
create trigger trg_rental_credit_applications_immutable
  before update or delete on rental_credit_applications
  for each row execute function _block_rental_credit_application_mutation();

-- Private replay helper for record_offline_rental_payment.
--
-- Zero-grant contract (like ach_authorizations in the 20260912 contract): revoked from
-- public/anon and granted to NO caller role, so it is reachable only from the SECURITY
-- DEFINER RPCs in this migration — which run as the table owner after passing
-- has_workspace_access. It resolves an idempotency key to the original recording, and
-- REJECTS a key reused with a different payload: returning someone else's receipt for a
-- mismatched retry would silently misattribute money, so a key collision (or caller bug)
-- fails loudly instead.
create or replace function _replay_offline_rental_payment(
  p_owner_id text, p_idempotency_key text, p_charge_id text, p_tenant_id text,
  p_amount_cents bigint, p_payment_method text, p_received_at timestamptz,
  p_receipt_reference text, p_notes text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_existing_payment rental_payments%rowtype;
  v_credit_id text;
  v_excess_cents bigint;
  v_credit_remaining bigint;
  v_applied_cents bigint;
begin
  select * into v_existing_payment from rental_payments
    where owner_id = p_owner_id and idempotency_key = p_idempotency_key;
  if not found then return null; end if;

  if v_existing_payment.charge_id is distinct from p_charge_id
     or v_existing_payment.tenant_id is distinct from p_tenant_id
     or v_existing_payment.amount_cents is distinct from p_amount_cents
     or v_existing_payment.payment_method is distinct from p_payment_method
     or v_existing_payment.received_at is distinct from p_received_at
     or nullif(btrim(v_existing_payment.receipt_reference), '') is distinct from nullif(btrim(p_receipt_reference), '')
     or nullif(btrim(v_existing_payment.notes), '') is distinct from nullif(btrim(p_notes), '')
  then
    raise exception 'Idempotency key % was already used with different payment details.', p_idempotency_key;
  end if;

  select c.id, c.amount_cents, c.remaining_cents
    into v_credit_id, v_excess_cents, v_credit_remaining
    from rental_tenant_credits c
    where c.owner_id = p_owner_id and c.source_payment_id = v_existing_payment.id;
  -- The credit's amount IS the excess; what was applied is the rest.
  v_applied_cents := v_existing_payment.amount_cents - coalesce(v_excess_cents, 0);
  return jsonb_build_object('id', v_existing_payment.id, 'chargeId', v_existing_payment.charge_id,
    'amountCents', v_existing_payment.amount_cents, 'appliedCents', v_applied_cents,
    'paymentMethod', v_existing_payment.payment_method, 'status', v_existing_payment.status,
    'receivedAt', v_existing_payment.received_at, 'replayed', true,
    'credit', case when v_credit_id is null then null
      else jsonb_build_object('id', v_credit_id, 'amountCents', v_excess_cents,
        'remainingCents', v_credit_remaining, 'sourcePaymentId', v_existing_payment.id) end);
end;
$$;

revoke all on function _replay_offline_rental_payment(text, text, text, text, bigint, text, timestamptz, text, text) from public, anon;
-- No positive grant: private helper, reachable only from the definer RPCs below.

-- record_offline_rental_payment: canonical 10-argument version.
--
-- Three additive capabilities, all backward compatible (every new parameter is defaulted,
-- and the historical 7-argument signature is preserved below as a thin wrapper so the
-- 20260912 explicit-grant contract keeps resolving):
--
--   p_allow_overpayment_credit: when true, an amount exceeding the charge's remaining
--     balance is accepted — the applied portion settles the charge and the excess is
--     recorded as an open tenant credit instead of being rejected.
--   p_tenant_id: the tenant the payment (and any credit) belongs to. Validated as a
--     member of the charge's lease. When null, the historical first-lease-membership
--     derivation is kept so old callers behave exactly as before.
--   p_idempotency_key: client-generated per submission intent. A repeat call with the
--     same key returns the original recording (payment + credit) without writing
--     anything new, so network retries can never record the same receipt twice.
--     Concurrent duplicates racing the first insert are caught via the
--     unique(owner_id, idempotency_key) constraint and resolved to the winner.
--     A key reused with a DIFFERENT payload is rejected, never replayed.
-- SECURITY DEFINER (with fixed search_path and the workspace check first): the credit
-- tables grant no direct writes to any caller role, so this RPC runs as the table owner
-- to create the credit row. Every write is scoped to p_owner_id, which the caller must
-- have workspace access to.
create or replace function record_offline_rental_payment(
  p_owner_id text, p_charge_id text, p_payment_method text, p_amount_cents bigint,
  p_received_at timestamptz, p_receipt_reference text default null, p_notes text default null,
  p_allow_overpayment_credit boolean default false,
  p_tenant_id text default null,
  p_idempotency_key text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_charge rent_charges%rowtype;
  v_payment_id text;
  v_applied_cents bigint;
  v_excess_cents bigint;
  v_new_paid bigint;
  v_status text;
  v_tenant_id text;
  v_credit_id text;
  v_key text;
  v_replay jsonb;
begin
  if p_owner_id is null or btrim(p_owner_id) = '' or not has_workspace_access(p_owner_id) then
    raise exception 'Authenticated owner id is required.';
  end if;
  if p_payment_method not in ('cash', 'cashiers_check') then
    raise exception 'Unsupported offline payment method.';
  end if;
  if p_amount_cents <= 0 then raise exception 'Offline payment amount must be positive.'; end if;
  if p_received_at is null or p_received_at > now() + interval '5 minutes' then
    raise exception 'A valid received date is required.'; end if;

  v_key := nullif(btrim(p_idempotency_key), '');

  -- Charge lookup (no lock yet) so the tenant can be attributed before the replay check:
  -- a replay must compare the full submission intent, including who paid.
  select * into v_charge from rent_charges where owner_id = p_owner_id and id = p_charge_id;
  if not found then raise exception 'Rent charge is not payable.'; end if;

  -- Honest tenant attribution: a caller that knows who handed over the cash names them
  -- (validated as a member of this lease); callers that predate the parameter keep the
  -- historical first-lease-membership derivation.
  if p_tenant_id is not null and btrim(p_tenant_id) <> '' then
    select lt.tenant_id into v_tenant_id from rental_lease_tenants lt
      where lt.owner_id = p_owner_id and lt.lease_id = v_charge.lease_id
        and lt.tenant_id = btrim(p_tenant_id);
    if not found then raise exception 'Tenant does not belong to this lease.'; end if;
  else
    select lt.tenant_id into v_tenant_id from rental_lease_tenants lt
      where lt.owner_id = p_owner_id and lt.lease_id = v_charge.lease_id
      order by lt.tenant_id limit 1;
    if not found then raise exception 'Lease tenant was not found.'; end if;
  end if;

  -- Idempotent replay, fast path: the same submission intent was already recorded.
  if v_key is not null then
    v_replay := _replay_offline_rental_payment(p_owner_id, v_key, p_charge_id, v_tenant_id,
      p_amount_cents, p_payment_method, p_received_at, p_receipt_reference, p_notes);
    if v_replay is not null then return v_replay; end if;
  end if;

  select * into v_charge from rent_charges where owner_id = p_owner_id and id = p_charge_id for update;
  if not found or v_charge.status in ('paid', 'void') then raise exception 'Rent charge is not payable.'; end if;

  -- Post-lock recheck: a concurrent retry with the same key may have won the race while
  -- this transaction waited on the charge lock. Resolve to the winner instead of
  -- recording the receipt twice.
  if v_key is not null then
    v_replay := _replay_offline_rental_payment(p_owner_id, v_key, p_charge_id, v_tenant_id,
      p_amount_cents, p_payment_method, p_received_at, p_receipt_reference, p_notes);
    if v_replay is not null then return v_replay; end if;
  end if;

  v_applied_cents := least(p_amount_cents, v_charge.amount_cents - v_charge.paid_amount_cents);
  v_excess_cents := p_amount_cents - v_applied_cents;
  if v_excess_cents > 0 and not coalesce(p_allow_overpayment_credit, false) then
    raise exception 'Payment exceeds the remaining rent balance.';
  end if;

  v_payment_id := 'rental_payment_' || gen_random_uuid()::text;
  v_new_paid := v_charge.paid_amount_cents + v_applied_cents;
  v_status := case when v_new_paid = v_charge.amount_cents then 'paid' else 'partially_paid' end;

  -- The payment row records the FULL amount actually received — the receipt, the cash
  -- drawer, and the ledger must agree on what came in. Only the applied portion moves
  -- the charge's paid balance; the excess becomes a credit below.
  begin
    insert into rental_payments (owner_id, id, charge_id, lease_id, tenant_id, provider, amount_cents,
      refunded_amount_cents, currency_code, status, idempotency_key, payment_method, received_at,
      recorded_by, receipt_reference, notes, created_at, updated_at, succeeded_at)
    values (p_owner_id, v_payment_id, v_charge.id, v_charge.lease_id, v_tenant_id, 'offline', p_amount_cents, 0,
      v_charge.currency_code, 'succeeded', coalesce(v_key, 'offline:' || v_payment_id), p_payment_method,
      p_received_at, auth.uid()::text, nullif(trim(p_receipt_reference), ''), nullif(trim(p_notes), ''),
      now(), now(), p_received_at);
  exception when unique_violation then
    -- Final backstop: a concurrent retry with the same idempotency key won the race
    -- between the post-lock recheck and this insert. Resolve to the winner.
    if v_key is null then raise; end if;
    v_replay := _replay_offline_rental_payment(p_owner_id, v_key, p_charge_id, v_tenant_id,
      p_amount_cents, p_payment_method, p_received_at, p_receipt_reference, p_notes);
    if v_replay is null then raise; end if;
    return v_replay;
  end;

  update rent_charges set paid_amount_cents = v_new_paid, status = v_status, updated_at = now()
    where owner_id = p_owner_id and id = v_charge.id;

  v_credit_id := null;
  if v_excess_cents > 0 then
    v_credit_id := 'rental_credit_' || gen_random_uuid()::text;
    insert into rental_tenant_credits (owner_id, id, tenant_id, lease_id, amount_cents, remaining_cents,
      source, source_payment_id, status, notes, created_at, updated_at)
    values (p_owner_id, v_credit_id, v_tenant_id, v_charge.lease_id, v_excess_cents, v_excess_cents,
      'overpayment', v_payment_id, 'open',
      'Overpayment on charge ' || v_charge.id || ' (' || coalesce(v_charge.period, v_charge.due_date::text) || ')',
      now(), now());
  end if;

  return jsonb_build_object('id', v_payment_id, 'chargeId', v_charge.id, 'amountCents', p_amount_cents,
    'appliedCents', v_applied_cents, 'paymentMethod', p_payment_method, 'status', 'succeeded',
    'receivedAt', p_received_at, 'replayed', false,
    'credit', case when v_credit_id is null then null
      else jsonb_build_object('id', v_credit_id, 'amountCents', v_excess_cents, 'remainingCents', v_excess_cents,
        'status', 'open', 'sourcePaymentId', v_payment_id) end);
end;
$$;

-- Historical 7-argument signature, preserved as a thin wrapper so the 20260912
-- explicit-grant contract and every existing caller keep resolving exactly as before.
-- Behavior is the pre-credit behavior: overpayments are rejected, the tenant is derived
-- from the lease's first membership, and no idempotency key is supplied.
create or replace function record_offline_rental_payment(
  p_owner_id text, p_charge_id text, p_payment_method text, p_amount_cents bigint,
  p_received_at timestamptz, p_receipt_reference text default null, p_notes text default null
) returns jsonb language plpgsql security invoker set search_path = public as $$
begin
  return record_offline_rental_payment(p_owner_id, p_charge_id, p_payment_method, p_amount_cents,
    p_received_at, p_receipt_reference, p_notes, false, null, null);
end;
$$;

revoke all on function record_offline_rental_payment(text, text, text, bigint, timestamptz, text, text, boolean, text, text) from public, anon;
grant execute on function record_offline_rental_payment(text, text, text, bigint, timestamptz, text, text, boolean, text, text) to authenticated;

-- Manually apply an open credit (full or partial) to a specific open charge — the path
-- for credits created after their target charge was already generated.
-- SECURITY DEFINER (fixed search_path, workspace check first): the credit tables grant no
-- direct writes, so this RPC runs as the table owner. All writes are scoped to p_owner_id.
create or replace function apply_rental_tenant_credit(
  p_owner_id text, p_credit_id text, p_charge_id text, p_amount_cents bigint,
  p_notes text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_credit rental_tenant_credits%rowtype;
  v_charge rent_charges%rowtype;
  v_applied_cents bigint;
  v_application_id text;
  v_new_credit_remaining bigint;
  v_credit_status text;
  v_new_paid bigint;
  v_charge_status text;
begin
  if p_owner_id is null or btrim(p_owner_id) = '' or not has_workspace_access(p_owner_id) then
    raise exception 'Authenticated owner id is required.';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'A positive credit application amount is required.';
  end if;

  -- Lock order (charge before credit) matches generate_monthly_rent_charge: every path
  -- that touches both rows locks rent_charges first, so concurrent generation and manual
  -- application can never deadlock against each other.
  select * into v_charge from rent_charges
    where owner_id = p_owner_id and id = p_charge_id for update;
  if not found or v_charge.status in ('paid', 'void') then raise exception 'Rent charge is not payable.'; end if;

  select * into v_credit from rental_tenant_credits
    where owner_id = p_owner_id and id = p_credit_id for update;
  if not found then raise exception 'Tenant credit was not found.'; end if;
  if v_credit.status <> 'open' then raise exception 'Tenant credit is not open.'; end if;

  if v_charge.lease_id <> v_credit.lease_id then
    raise exception 'Credit and charge must belong to the same lease.';
  end if;

  v_applied_cents := least(p_amount_cents, v_credit.remaining_cents,
    v_charge.amount_cents - v_charge.paid_amount_cents);
  if v_applied_cents <= 0 then raise exception 'There is nothing to apply this credit to.'; end if;

  v_application_id := 'rental_credit_application_' || gen_random_uuid()::text;
  insert into rental_credit_applications (owner_id, id, credit_id, tenant_id, lease_id, charge_id,
    amount_cents, applied_at, applied_by, notes)
  values (p_owner_id, v_application_id, v_credit.id, v_credit.tenant_id, v_credit.lease_id,
    v_charge.id, v_applied_cents, now(), auth.uid()::text, nullif(trim(p_notes), ''));

  v_new_credit_remaining := v_credit.remaining_cents - v_applied_cents;
  v_credit_status := case when v_new_credit_remaining = 0 then 'fully_applied' else 'open' end;
  update rental_tenant_credits set remaining_cents = v_new_credit_remaining, status = v_credit_status,
    updated_at = now() where owner_id = p_owner_id and id = v_credit.id;

  v_new_paid := v_charge.paid_amount_cents + v_applied_cents;
  v_charge_status := case when v_new_paid = v_charge.amount_cents then 'paid' else 'partially_paid' end;
  update rent_charges set paid_amount_cents = v_new_paid, status = v_charge_status, updated_at = now()
    where owner_id = p_owner_id and id = v_charge.id;

  return jsonb_build_object('id', v_application_id, 'creditId', v_credit.id, 'chargeId', v_charge.id,
    'amountCents', v_applied_cents, 'creditRemainingCents', v_new_credit_remaining,
    'creditStatus', v_credit_status);
end;
$$;

revoke all on function apply_rental_tenant_credit(text, text, text, bigint, text) from public, anon;
grant execute on function apply_rental_tenant_credit(text, text, text, bigint, text) to authenticated;

-- Void a credit's unapplied remainder with a reason. Applications already consumed by a
-- charge are immutable history — only the still-open remainder is voided. The void is
-- a complete audit record: who, when, and why live in dedicated columns.
-- SECURITY DEFINER (fixed search_path, workspace check first): same rationale as above.
create or replace function void_rental_tenant_credit(
  p_owner_id text, p_credit_id text, p_reason text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_credit rental_tenant_credits%rowtype;
begin
  if p_owner_id is null or btrim(p_owner_id) = '' or not has_workspace_access(p_owner_id) then
    raise exception 'Authenticated owner id is required.';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A reason is required to void a credit.';
  end if;
  select * into v_credit from rental_tenant_credits
    where owner_id = p_owner_id and id = p_credit_id for update;
  if not found then raise exception 'Tenant credit was not found.'; end if;
  if v_credit.status <> 'open' then raise exception 'Only an open credit can be voided.'; end if;

  update rental_tenant_credits
    set remaining_cents = 0, status = 'void',
      voided_at = now(), voided_by = auth.uid()::text, void_reason = btrim(p_reason),
      updated_at = now()
    where owner_id = p_owner_id and id = v_credit.id;

  return jsonb_build_object('id', v_credit.id, 'status', 'void',
    'voidedRemainingCents', v_credit.remaining_cents,
    'voidedAt', now(), 'voidReason', btrim(p_reason));
end;
$$;

revoke all on function void_rental_tenant_credit(text, text, text) from public, anon;
grant execute on function void_rental_tenant_credit(text, text, text) to authenticated;

-- generate_monthly_rent_charge: the 20260829 workspace-access authorization is preserved
-- verbatim, as is the voided-charge exclusion on the conflict-hit re-select. The only
-- additive change: after creating a NEW charge (never on a conflict-hit of an existing
-- charge, which would double-apply), this lease's open credits auto-apply FIFO.
-- The credit belongs to the lease's FORGE books regardless of collection mode — it is the
-- tenant's money already received, not a collection action.
-- SECURITY DEFINER (fixed search_path, workspace check preserved verbatim): the FIFO
-- auto-apply writes to the credit tables, which grant no direct writes.
create or replace function generate_monthly_rent_charge(
    p_owner_id text,
    p_schedule_id text,
    p_period text
)
returns rent_charges
language plpgsql
security definer
set search_path = public
as $$
declare
    authenticated_owner_id text := auth.uid()::text;
    schedule rent_schedules%rowtype;
    generated rent_charges%rowtype;
    required_period text := nullif(btrim(p_period), '');
    required_source_key text;
    required_due_date date;
    current_status text;
    inserted_id text;
    credit rental_tenant_credits%rowtype;
    charge_remaining bigint;
    apply_cents bigint;
    application_id text;
    new_credit_remaining bigint;
    new_credit_status text;
    new_paid bigint;
    new_charge_status text;
begin
    if authenticated_owner_id is null then
        raise exception 'Authenticated owner id is required.' using errcode = '42501';
    end if;
    if p_owner_id is null or btrim(p_owner_id) = '' or not has_workspace_access(p_owner_id) then
        raise exception 'Rent charge owner does not match authenticated owner.' using errcode = '42501';
    end if;
    if required_period is null or required_period !~ '^[0-9]{4}-[0-9]{2}$' then
        raise exception 'Rent charge period must use YYYY-MM format.' using errcode = '22023';
    end if;

    select * into schedule from rent_schedules
     where owner_id = p_owner_id and id = p_schedule_id for update;
    if not found then raise exception 'Rent schedule was not found.' using errcode = 'P0002'; end if;
    if schedule.status <> 'active' then return null; end if;

    required_due_date := (required_period || '-' || lpad(schedule.due_day::text, 2, '0'))::date;
    if required_due_date < schedule.effective_start_date
       or (schedule.effective_end_date is not null and required_due_date > schedule.effective_end_date)
    then return null; end if;

    required_source_key := 'rent:' || schedule.id || ':' || required_period;
    current_status := case when required_due_date > current_date then 'scheduled' else 'due' end;

    insert into rent_charges (
        owner_id, id, lease_id, schedule_id, period, due_date, amount_cents,
        paid_amount_cents, currency_code, status, source_key, created_at, updated_at
    ) values (
        p_owner_id, 'rent_charge_' || schedule.id || '_' || replace(required_period, '-', ''),
        schedule.lease_id, schedule.id, required_period, required_due_date, schedule.amount_cents,
        0, schedule.currency_code, current_status, required_source_key, now(), now()
    )
    on conflict (owner_id, source_key) do nothing
    returning id into inserted_id;

    -- Only a freshly created charge consumes credits. A conflict-hit returns the existing
    -- charge untouched — re-running generation must never double-apply.
    if inserted_id is not null then
      select * into generated from rent_charges
        where owner_id = p_owner_id and id = inserted_id for update;
      charge_remaining := generated.amount_cents;
      for credit in
        select * from rental_tenant_credits
          where owner_id = p_owner_id and lease_id = schedule.lease_id and status = 'open'
            and remaining_cents > 0
          order by created_at asc, id asc
          for update
      loop
        exit when charge_remaining <= 0;
        apply_cents := least(credit.remaining_cents, charge_remaining);
        application_id := 'rental_credit_application_' || gen_random_uuid()::text;
        insert into rental_credit_applications (owner_id, id, credit_id, tenant_id, lease_id,
          charge_id, amount_cents, applied_at, applied_by, notes)
        values (p_owner_id, application_id, credit.id, credit.tenant_id, credit.lease_id,
          generated.id, apply_cents, now(), authenticated_owner_id,
          'Auto-applied to generated charge ' || required_period);
        new_credit_remaining := credit.remaining_cents - apply_cents;
        new_credit_status := case when new_credit_remaining = 0 then 'fully_applied' else 'open' end;
        update rental_tenant_credits set remaining_cents = new_credit_remaining,
          status = new_credit_status, updated_at = now()
          where owner_id = p_owner_id and id = credit.id;
        charge_remaining := charge_remaining - apply_cents;
      end loop;
      if charge_remaining < generated.amount_cents then
        new_paid := generated.amount_cents - charge_remaining;
        new_charge_status := case when charge_remaining = 0 then 'paid' else 'partially_paid' end;
        update rent_charges set paid_amount_cents = new_paid, status = new_charge_status, updated_at = now()
          where owner_id = p_owner_id and id = generated.id;
        select * into generated from rent_charges where owner_id = p_owner_id and id = generated.id;
      end if;
      return generated;
    end if;

    select * into generated from rent_charges
     where owner_id = p_owner_id and source_key = required_source_key and status <> 'void';
    return generated;
end;
$$;

revoke all on function generate_monthly_rent_charge(text, text, text) from public;
grant execute on function generate_monthly_rent_charge(text, text, text) to authenticated;
