-- Rentec parity R11: payment policies (allow any amount / require rent /
-- require balance) + per-tenant override.
--
-- 1. Portfolio-level payment policy on rental_billing_settings (the existing
--    owner-level settings pattern): allow_any_amount | require_rent |
--    require_balance. Defaults to allow_any_amount for every owner, including
--    existing ones -- enabling billing must never newly block a tenant's
--    payment, so the permissive policy is the default.
-- 2. Per-tenant override: rental_tenants.payment_policy. NULL = inherit the
--    portfolio default.
-- 3. Audit trail for portfolio policy changes, mirroring
--    rental_late_fee_settings_audit.
--
-- Enforcement (server-side, in the API routes -- never client-only):
-- - tenant portal payment-session: the computed payment amount must satisfy
--   the tenant's effective policy before a Stripe session is created;
--   rejected with HTTP 422 and a Brandy-readable message.
-- - owner manual recording (record_offline_rental_payment path): the entered
--   amount must satisfy the policy before the RPC runs.
-- Stripe autopay is EXEMPT by design: autopay amounts are computed from the
-- consented schedule (tenant-enrolled, never tenant-entered); the policy
-- governs tenant-initiated payment amounts, not scheduled collections.
--
-- NOT APPLIED -- ships with the R11 PR; Jason applies production migrations.

-- Portfolio-level payment policy.
alter table rental_billing_settings
  add column if not exists payment_policy text not null default 'allow_any_amount';
alter table rental_billing_settings
  drop constraint if exists rental_billing_settings_payment_policy_check;
alter table rental_billing_settings
  add constraint rental_billing_settings_payment_policy_check check (
    payment_policy in ('allow_any_amount', 'require_rent', 'require_balance')
  );

-- Per-tenant override. NULL = inherit the portfolio default.
alter table rental_tenants
  add column if not exists payment_policy text;
alter table rental_tenants
  drop constraint if exists rental_tenants_payment_policy_check;
alter table rental_tenants
  add constraint rental_tenants_payment_policy_check check (
    payment_policy is null
    or payment_policy in ('allow_any_amount', 'require_rent', 'require_balance')
  );

-- Audit: every portfolio policy change is recorded (who, when, what).
create table if not exists rental_payment_policy_audit (
    id text primary key default ('rental_payment_policy_audit_' || gen_random_uuid()::text),
    owner_id text not null,
    change jsonb not null,
    performed_by text not null,
    performed_at timestamptz not null default now()
);
create index if not exists idx_payment_policy_audit_owner
  on rental_payment_policy_audit (owner_id, performed_at);
alter table rental_payment_policy_audit enable row level security;
alter table rental_payment_policy_audit force row level security;
create policy "payment_policy_audit_owner_select" on rental_payment_policy_audit
  for select to authenticated using (has_workspace_access(owner_id));

-- Audited, owner-scoped write for the portfolio payment policy -- mirrors
-- set_rental_late_fee_auto_settings: explicit value, workspace-access check,
-- every change recorded. Invalid policy values are rejected before any write.
create or replace function public.set_rental_payment_policy(p_owner_id text, p_policy text)
returns rental_billing_settings
language plpgsql
set search_path to 'public'
as $function$
declare
    authenticated_owner_id text := auth.uid()::text;
    v_policy text := btrim(p_policy);
    previous jsonb;
    result rental_billing_settings;
begin
    if authenticated_owner_id is null then
        raise exception 'Authenticated owner id is required.' using errcode = '42501';
    end if;
    if p_owner_id is null or btrim(p_owner_id) = '' or not has_workspace_access(p_owner_id) then
        raise exception 'Payment policy owner does not match authenticated owner.' using errcode = '42501';
    end if;
    if v_policy is null or v_policy = ''
       or v_policy not in ('allow_any_amount', 'require_rent', 'require_balance') then
        raise exception 'Payment policy must be allow_any_amount, require_rent, or require_balance.' using errcode = '22023';
    end if;

    select to_jsonb(r) into previous
      from rental_billing_settings r where r.owner_id = p_owner_id;

    insert into rental_billing_settings (owner_id, payment_policy, updated_at)
    values (p_owner_id, v_policy, now())
    on conflict (owner_id) do update
      set payment_policy = excluded.payment_policy,
          updated_at = excluded.updated_at;

    select * into result from rental_billing_settings where owner_id = p_owner_id;

    insert into rental_payment_policy_audit (owner_id, change, performed_by)
    values (p_owner_id,
            jsonb_build_object('previous', coalesce(previous -> 'payment_policy', 'null'::jsonb),
                               'new', v_policy),
            authenticated_owner_id);

    return result;
end;
$function$;
revoke all on function public.set_rental_payment_policy(text, text) from public, anon;
grant execute on function public.set_rental_payment_policy(text, text) to authenticated;
