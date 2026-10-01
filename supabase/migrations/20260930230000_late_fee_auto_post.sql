-- Rentec parity R1: late-fee automation.
--
-- 1. Portfolio-level late-fee auto-post settings on rental_billing_settings
--    (the existing owner-level settings pattern): auto-post toggle, grace
--    days, and the fixed/percentage calculation with an optional cap.
--    Defaults keep auto-post OFF for every owner, including existing ones —
--    enabling billing must never implicitly start auto-charging tenants.
-- 2. Per-tenant overrides: a tenant-level setting that overrides the
--    portfolio default (grace days / fee / exempt).
-- 3. Audit trail for auto-post settings changes, mirroring
--    rental_billing_settings_audit.
--
-- NOT APPLIED — ships with the R1 PR; Jason applies production migrations.

alter table rental_billing_settings
  add column if not exists late_fee_auto_post boolean not null default false,
  add column if not exists late_fee_grace_days smallint,
  add column if not exists late_fee_calculation_type text,
  add column if not exists late_fee_fixed_amount_cents bigint,
  add column if not exists late_fee_percentage_basis_points integer,
  add column if not exists late_fee_maximum_amount_cents bigint;

alter table rental_billing_settings
  drop constraint if exists rental_billing_settings_late_fee_check;
alter table rental_billing_settings
  add constraint rental_billing_settings_late_fee_check check (
    late_fee_grace_days is null or (late_fee_grace_days between 0 and 31)
  );
alter table rental_billing_settings
  drop constraint if exists rental_billing_settings_late_fee_calc_check;
alter table rental_billing_settings
  add constraint rental_billing_settings_late_fee_calc_check check (
    late_fee_calculation_type is null
    or late_fee_calculation_type in ('fixed', 'percentage')
  );
alter table rental_billing_settings
  drop constraint if exists rental_billing_settings_late_fee_amounts_check;
alter table rental_billing_settings
  add constraint rental_billing_settings_late_fee_amounts_check check (
    (late_fee_fixed_amount_cents is null or late_fee_fixed_amount_cents > 0)
    and (late_fee_percentage_basis_points is null or late_fee_percentage_basis_points > 0)
    and (late_fee_maximum_amount_cents is null or late_fee_maximum_amount_cents > 0)
    and not (late_fee_calculation_type = 'fixed' and late_fee_percentage_basis_points is not null)
    and not (late_fee_calculation_type = 'percentage' and late_fee_fixed_amount_cents is not null)
  );

-- Per-tenant late-fee override. Any column left NULL falls back to the
-- portfolio default; exempt=true skips the tenant entirely (no auto fee).
create table if not exists rental_late_fee_tenant_overrides (
    owner_id text not null,
    tenant_id text not null,
    exempt boolean not null default false,
    grace_days smallint,
    calculation_type text,
    fixed_amount_cents bigint,
    percentage_basis_points integer,
    maximum_amount_cents bigint,
    updated_at timestamptz not null default now(),
    primary key (owner_id, tenant_id),
    foreign key (owner_id, tenant_id) references rental_tenants(owner_id, id) on delete cascade,
    check (grace_days is null or (grace_days between 0 and 31)),
    check (calculation_type is null or calculation_type in ('fixed', 'percentage')),
    check (fixed_amount_cents is null or fixed_amount_cents > 0),
    check (percentage_basis_points is null or percentage_basis_points > 0),
    check (maximum_amount_cents is null or maximum_amount_cents > 0),
    check (not (calculation_type = 'fixed' and percentage_basis_points is not null)),
    check (not (calculation_type = 'percentage' and fixed_amount_cents is not null))
);
create index if not exists idx_late_fee_tenant_overrides_tenant
  on rental_late_fee_tenant_overrides (owner_id, tenant_id);
alter table rental_late_fee_tenant_overrides enable row level security;
alter table rental_late_fee_tenant_overrides force row level security;
create policy "late_fee_override_owner_all" on rental_late_fee_tenant_overrides
  for all to authenticated using (has_workspace_access(owner_id))
  with check (has_workspace_access(owner_id));

-- Audit: every auto-post settings change is recorded (who, when, what).
create table if not exists rental_late_fee_settings_audit (
    id text primary key default ('rental_late_fee_settings_audit_' || gen_random_uuid()::text),
    owner_id text not null,
    change jsonb not null,
    performed_by text not null,
    performed_at timestamptz not null default now()
);
create index if not exists idx_late_fee_settings_audit_owner
  on rental_late_fee_settings_audit (owner_id, performed_at);
alter table rental_late_fee_settings_audit enable row level security;
alter table rental_late_fee_settings_audit force row level security;
create policy "late_fee_settings_audit_owner_select" on rental_late_fee_settings_audit
  for select to authenticated using (has_workspace_access(owner_id));

-- Audited, owner-scoped write for the auto-post settings — mirrors
-- set_rental_billing_enabled: explicit values, workspace-access check, every
-- change recorded. Disabling keeps the stored calculation so re-enabling
-- restores it; only the toggle is validated when turning off.
create or replace function public.set_rental_late_fee_auto_settings(p_owner_id text, p_settings jsonb)
returns rental_billing_settings
language plpgsql
set search_path to 'public'
as $function$
declare
    authenticated_owner_id text := auth.uid()::text;
    v_enabled boolean := nullif(p_settings ->> 'enabled', '')::boolean;
    v_grace_days smallint := nullif(p_settings ->> 'graceDays', '')::smallint;
    v_calc text := nullif(btrim(p_settings ->> 'calculationType'), '');
    v_fixed bigint := nullif(p_settings ->> 'fixedAmountCents', '')::bigint;
    v_pct integer := nullif(p_settings ->> 'percentageBasisPoints', '')::integer;
    v_max bigint := nullif(p_settings ->> 'maximumAmountCents', '')::bigint;
    previous jsonb;
    result rental_billing_settings;
begin
    if authenticated_owner_id is null then
        raise exception 'Authenticated owner id is required.' using errcode = '42501';
    end if;
    if p_owner_id is null or btrim(p_owner_id) = '' or not has_workspace_access(p_owner_id) then
        raise exception 'Late-fee settings owner does not match authenticated owner.' using errcode = '42501';
    end if;
    if v_enabled is null then
        raise exception 'An explicit enabled value is required.' using errcode = '22023';
    end if;
    if v_enabled then
        if v_grace_days is null or v_grace_days < 0 or v_grace_days > 31 then
            raise exception 'Grace days must be between 0 and 31.' using errcode = '22023';
        end if;
        if v_calc not in ('fixed', 'percentage') then
            raise exception 'Calculation type must be fixed or percentage.' using errcode = '22023';
        end if;
        if v_calc = 'fixed' and (v_fixed is null or v_fixed <= 0) then
            raise exception 'A positive fixed amount is required.' using errcode = '22023';
        end if;
        if v_calc = 'percentage' and (v_pct is null or v_pct <= 0) then
            raise exception 'A positive percentage is required.' using errcode = '22023';
        end if;
        if v_max is not null and v_max <= 0 then
            raise exception 'Maximum amount must be positive.' using errcode = '22023';
        end if;
    end if;

    select jsonb_build_object('enabled', coalesce(late_fee_auto_post, false), 'graceDays', late_fee_grace_days,
        'calculationType', late_fee_calculation_type, 'fixedAmountCents', late_fee_fixed_amount_cents,
        'percentageBasisPoints', late_fee_percentage_basis_points, 'maximumAmountCents', late_fee_maximum_amount_cents)
      into previous from rental_billing_settings where owner_id = p_owner_id;
    previous := coalesce(previous, '{"enabled": false}'::jsonb);

    insert into rental_billing_settings (owner_id, late_fee_auto_post, late_fee_grace_days,
        late_fee_calculation_type, late_fee_fixed_amount_cents, late_fee_percentage_basis_points,
        late_fee_maximum_amount_cents, updated_at, updated_by)
    values (p_owner_id, v_enabled, v_grace_days, v_calc,
        case when v_calc = 'fixed' then v_fixed end,
        case when v_calc = 'percentage' then v_pct end,
        v_max, now(), authenticated_owner_id)
    on conflict (owner_id) do update
      set late_fee_auto_post = excluded.late_fee_auto_post,
          -- Disabling keeps the stored calculation so re-enabling restores it.
          late_fee_grace_days = case when excluded.late_fee_auto_post then excluded.late_fee_grace_days else rental_billing_settings.late_fee_grace_days end,
          late_fee_calculation_type = case when excluded.late_fee_auto_post then excluded.late_fee_calculation_type else rental_billing_settings.late_fee_calculation_type end,
          late_fee_fixed_amount_cents = case when excluded.late_fee_auto_post then excluded.late_fee_fixed_amount_cents else rental_billing_settings.late_fee_fixed_amount_cents end,
          late_fee_percentage_basis_points = case when excluded.late_fee_auto_post then excluded.late_fee_percentage_basis_points else rental_billing_settings.late_fee_percentage_basis_points end,
          late_fee_maximum_amount_cents = case when excluded.late_fee_auto_post then excluded.late_fee_maximum_amount_cents else rental_billing_settings.late_fee_maximum_amount_cents end,
          updated_at = now(), updated_by = excluded.updated_by
    returning * into result;

    insert into rental_late_fee_settings_audit (owner_id, change, performed_by)
    values (p_owner_id, jsonb_build_object('from', previous, 'to', p_settings), authenticated_owner_id);

    return result;
end;
$function$;

revoke all on function public.set_rental_late_fee_auto_settings(text, jsonb) from public, anon;
grant execute on function public.set_rental_late_fee_auto_settings(text, jsonb) to authenticated;
