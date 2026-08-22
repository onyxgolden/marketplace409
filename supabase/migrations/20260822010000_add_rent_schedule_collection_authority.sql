-- Rental billing cutover containment: most tenants still pay through Rentec, but FORGE has been
-- generating collectible charges for every 'active' rent_schedule regardless of who actually
-- collects rent for that lease. These are real rent obligations, not fabricated ones — but their
-- satisfaction is unresolved until Rentec evidence is reconciled, and treating them as FORGE
-- overdue risks double-collecting a tenant once they're eventually invited to FORGE.
--
-- rent_schedules.status already represents schedule LIFECYCLE ('draft' | 'active' | 'paused' |
-- 'ended') — whether the schedule is currently in force at all. It is deliberately NOT overloaded
-- here. Collection AUTHORITY — who is actually owed and collecting money for this lease right now
-- — is an orthogonal concept and gets its own column, so a schedule can be lifecycle-'active' (the
-- lease is a going concern) while collection_mode stays 'external' (Rentec still collects it) for
-- as long as needed, with zero ambiguity about which concept a query is filtering on.
--
-- NOT applied remotely by this change — local migration file only.

alter table rent_schedules add column if not exists collection_mode text not null default 'external'
  check (collection_mode in ('external', 'forge', 'paused'));
alter table rent_schedules add column if not exists collection_provider text default 'rentec'
  check (collection_provider is null or collection_provider in ('rentec'));
alter table rent_schedules add column if not exists forge_cutover_date date;
alter table rent_schedules add column if not exists forge_cutover_activated_at timestamptz;
alter table rent_schedules add column if not exists forge_cutover_activated_by text;

-- A 'forge' schedule must carry the cutover date that makes it collectible; a 'paused' or
-- 'external' schedule must not carry one (voiding cutover means clearing it, not just switching
-- the mode away — this makes "was cutover, then paused" visible in history via
-- forge_cutover_activated_at/_by, which are never cleared, rather than silently ambiguous).
alter table rent_schedules add constraint rent_schedules_forge_requires_cutover_date
  check (collection_mode <> 'forge' or forge_cutover_date is not null);
alter table rent_schedules add constraint rent_schedules_non_forge_has_no_cutover_date
  check (collection_mode = 'forge' or forge_cutover_date is null);

-- Every existing schedule — with no exceptions, including the one already used for the live
-- Stripe card-payment validation (Brandy Morgan, the $20/month FORGE SANDBOX TEST PROPERTY lease)
-- — backfills to 'external' via the column default above. No separate UPDATE runs here for any
-- schedule. That validation already proved the payment/refund/webhook mechanics end to end; it did
-- not, and should not, stand in for a reviewed billing cutover. Continuing to collect that lease
-- through FORGE now requires the same explicit, owner-authenticated
-- activate_forge_billing_collection() call as any other schedule — no migration-granted exception.

create index if not exists idx_rent_schedules_collection_mode on rent_schedules (owner_id, collection_mode);

-- Function-level audit trail for the cutover action itself (distinct from Rentec import commits,
-- which already have their own audit surface via source_system/source_record_id).
create table if not exists rent_schedule_collection_cutover_audit (
    id text primary key default ('rental_cutover_audit_' || gen_random_uuid()::text),
    owner_id text not null,
    schedule_id text not null,
    lease_id text not null,
    from_collection_mode text not null,
    to_collection_mode text not null,
    cutover_date date,
    reconciliation_summary jsonb not null default '{}'::jsonb,
    performed_by text not null,
    performed_at timestamptz not null default now(),
    foreign key (owner_id, schedule_id) references rent_schedules (owner_id, id) on delete restrict
);
create index if not exists idx_rent_schedule_cutover_audit_owner_schedule
  on rent_schedule_collection_cutover_audit (owner_id, schedule_id);

alter table rent_schedule_collection_cutover_audit enable row level security;
alter table rent_schedule_collection_cutover_audit force row level security;
create policy "rent_schedule_cutover_audit_owner_select" on rent_schedule_collection_cutover_audit
  for select to authenticated using (owner_id = auth.uid()::text);

-- Explicit, reviewed, owner-scoped, idempotent activation. Idempotent: re-running with the same
-- cutover date on an already-'forge' schedule is a no-op (not an error, not a duplicate audit row)
-- so a retried request can never double-activate or double-log. Auditable: every state transition
-- (including "no-op, already active") is recorded.
create or replace function activate_forge_billing_collection(
    p_owner_id text,
    p_schedule_id text,
    p_cutover_date date,
    p_reconciliation_summary jsonb default '{}'::jsonb
)
returns rent_schedules
language plpgsql
security invoker
set search_path = public
as $$
declare
    authenticated_owner_id text := auth.uid()::text;
    schedule rent_schedules%rowtype;
    previous_mode text;
begin
    if authenticated_owner_id is null then
        raise exception 'Authenticated owner id is required.' using errcode = '42501';
    end if;
    if p_owner_id is null or btrim(p_owner_id) = '' or p_owner_id <> authenticated_owner_id then
        raise exception 'Rent schedule owner does not match authenticated owner.' using errcode = '42501';
    end if;
    if p_cutover_date is null then
        raise exception 'A reviewed FORGE cutover date is required.' using errcode = '22023';
    end if;

    select * into schedule from rent_schedules where owner_id = p_owner_id and id = p_schedule_id for update;
    if not found then raise exception 'Rent schedule was not found.' using errcode = 'P0002'; end if;
    if schedule.collection_mode = 'forge' and schedule.forge_cutover_date = p_cutover_date then
        -- Idempotent no-op: identical retry of an already-completed activation.
        insert into rent_schedule_collection_cutover_audit
          (owner_id, schedule_id, lease_id, from_collection_mode, to_collection_mode, cutover_date, reconciliation_summary, performed_by)
        values (p_owner_id, schedule.id, schedule.lease_id, 'forge', 'forge', p_cutover_date, coalesce(p_reconciliation_summary, '{}'::jsonb) || jsonb_build_object('noop', true), authenticated_owner_id);
        return schedule;
    end if;
    if schedule.collection_mode = 'forge' then
        raise exception 'This schedule is already FORGE-collectible under a different cutover date; correct it explicitly rather than re-activating.' using errcode = '22023';
    end if;

    previous_mode := schedule.collection_mode;
    update rent_schedules
       set collection_mode = 'forge',
           forge_cutover_date = p_cutover_date,
           forge_cutover_activated_at = now(),
           forge_cutover_activated_by = authenticated_owner_id,
           updated_at = now()
     where owner_id = p_owner_id and id = schedule.id
     returning * into schedule;

    insert into rent_schedule_collection_cutover_audit
      (owner_id, schedule_id, lease_id, from_collection_mode, to_collection_mode, cutover_date, reconciliation_summary, performed_by)
    values (p_owner_id, schedule.id, schedule.lease_id, previous_mode, 'forge', p_cutover_date, coalesce(p_reconciliation_summary, '{}'::jsonb), authenticated_owner_id);

    return schedule;
end;
$$;

revoke all on function activate_forge_billing_collection(text, text, date, jsonb) from public;
grant execute on function activate_forge_billing_collection(text, text, date, jsonb) to authenticated;

-- Autopay must never enroll or execute against an external/paused lease — a tenant could otherwise
-- authorize FORGE to auto-charge a card for rent Rentec is still collecting.
create or replace function request_rental_autopay_enrollment(p_lease_id text,p_payment_method_type text,p_charge_day smallint,p_reminder_days_before smallint,p_consent_text text)
returns rental_autopay_enrollments language plpgsql security invoker set search_path=public as $$
declare t rental_tenants; result rental_autopay_enrollments; s rent_schedules;
begin
  select tenant.* into t from rental_tenants tenant join rental_lease_tenants m on m.owner_id=tenant.owner_id and m.tenant_id=tenant.id
  where tenant.auth_user_id=auth.uid() and m.lease_id=p_lease_id limit 1;
  if t.id is null then raise exception 'Active tenant lease access is required.'; end if;
  select * into s from rent_schedules where owner_id=t.owner_id and lease_id=p_lease_id and status='active' order by effective_start_date desc limit 1;
  if s.id is null or s.collection_mode <> 'forge' or s.forge_cutover_date is null or s.forge_cutover_date > current_date then
    raise exception 'This lease is not currently collected through FORGE.';
  end if;
  -- Owner-level master pause overrides an otherwise-eligible per-schedule cutover: a lease can be
  -- individually FORGE-activated and still not accept autopay while the owner's billing is paused.
  if not coalesce((select billing_enabled from rental_billing_settings where owner_id = t.owner_id), false) then
    raise exception 'Rental online billing is currently paused for this owner.';
  end if;
  if p_payment_method_type not in ('card','us_bank_account') then raise exception 'Unsupported autopay payment method.'; end if;
  if p_charge_day not between 1 and 28 or p_reminder_days_before not between 0 and 14 then raise exception 'Autopay timing is invalid.'; end if;
  if length(btrim(coalesce(p_consent_text,''))) < 40 then raise exception 'Explicit autopay consent is required.'; end if;
  insert into rental_autopay_enrollments(owner_id,id,lease_id,tenant_id,status,payment_method_type,charge_day,reminder_days_before,consent_text,consented_at)
  values(t.owner_id,'rental_autopay_'||gen_random_uuid()::text,p_lease_id,t.id,'setup_required',p_payment_method_type,p_charge_day,p_reminder_days_before,btrim(p_consent_text),now()) returning * into result;
  return result;
end $$;
grant execute on function request_rental_autopay_enrollment(text,text,smallint,smallint,text) to authenticated;

-- Owner-level "Rental Billing master pause": a single global gate that sits ABOVE the per-schedule
-- collection_mode. FORGE may only collect for a given lease when BOTH the owner's billing is
-- enabled here AND that lease's schedule is individually 'forge' with an arrived cutover date —
-- enabling this flag alone activates nothing, since every schedule still defaults to 'external'.
-- Defaults to disabled (paused) for every owner, including existing owners, so enabling FORGE
-- containment cannot itself turn on live collection anywhere.
create table if not exists rental_billing_settings (
    owner_id text primary key,
    billing_enabled boolean not null default false,
    updated_at timestamptz not null default now(),
    updated_by text
);
alter table rental_billing_settings enable row level security;
alter table rental_billing_settings force row level security;
create policy "rental_billing_settings_owner_select" on rental_billing_settings
  for select to authenticated using (owner_id = auth.uid()::text);

create table if not exists rental_billing_settings_audit (
    id text primary key default ('rental_billing_settings_audit_' || gen_random_uuid()::text),
    owner_id text not null,
    from_enabled boolean not null,
    to_enabled boolean not null,
    performed_by text not null,
    performed_at timestamptz not null default now()
);
create index if not exists idx_rental_billing_settings_audit_owner
  on rental_billing_settings_audit (owner_id, performed_at);
alter table rental_billing_settings_audit enable row level security;
alter table rental_billing_settings_audit force row level security;
create policy "rental_billing_settings_audit_owner_select" on rental_billing_settings_audit
  for select to authenticated using (owner_id = auth.uid()::text);

-- Explicit, owner-scoped, idempotent, audited pause/resume. Idempotent: setting the flag to its
-- current value is a no-op state transition but is still audited (every request, including a
-- repeated one, is recorded) so the UI can safely retry without inflating history with fake
-- transitions in the *state* while still proving the request happened.
create or replace function set_rental_billing_enabled(
    p_owner_id text,
    p_enabled boolean
)
returns rental_billing_settings
language plpgsql
security invoker
set search_path = public
as $$
declare
    authenticated_owner_id text := auth.uid()::text;
    previous_enabled boolean;
    result rental_billing_settings;
begin
    if authenticated_owner_id is null then
        raise exception 'Authenticated owner id is required.' using errcode = '42501';
    end if;
    if p_owner_id is null or btrim(p_owner_id) = '' or p_owner_id <> authenticated_owner_id then
        raise exception 'Rental billing settings owner does not match authenticated owner.' using errcode = '42501';
    end if;
    if p_enabled is null then
        raise exception 'An explicit billing_enabled value is required.' using errcode = '22023';
    end if;

    select coalesce(billing_enabled, false) into previous_enabled
      from rental_billing_settings where owner_id = p_owner_id;
    previous_enabled := coalesce(previous_enabled, false);

    insert into rental_billing_settings (owner_id, billing_enabled, updated_at, updated_by)
    values (p_owner_id, p_enabled, now(), authenticated_owner_id)
    on conflict (owner_id) do update
      set billing_enabled = excluded.billing_enabled, updated_at = now(), updated_by = excluded.updated_by
    returning * into result;

    insert into rental_billing_settings_audit (owner_id, from_enabled, to_enabled, performed_by)
    values (p_owner_id, previous_enabled, p_enabled, authenticated_owner_id);

    return result;
end;
$$;

revoke all on function set_rental_billing_enabled(text, boolean) from public;
grant execute on function set_rental_billing_enabled(text, boolean) to authenticated;
