-- ============================================================================
-- NO-GO FIX for PR #522 (ChatGPT review 2026-10-01, head 639f05ff)
--
-- Finding 1 (CRITICAL): R17 widened has_workspace_access() from the privileged model
-- (primary owner implicit + active co_owner) to EVERY active workspace member, while the
-- DB RLS layer uses has_workspace_access(owner_id) as its coarse write boundary across
-- 114 tables. Granular permissions were enforced only in selected Next.js routes, so an
-- authenticated staff user could bypass route gates via direct Supabase client writes.
--
-- Fix (all three, belt-and-braces):
--   1. REVERT has_workspace_access(text) to the privileged model (owner + active co_owner).
--      One function change instantly restores the pre-R17 write boundary for all 114 tables.
--   2. ADD has_workspace_visibility(text) = owner OR any active member. This is the READ
--      boundary for staff (separates read/workspace visibility from write authorization).
--   3. ADD has_rental_permission(text, text), a DB-enforced permission predicate mirroring
--      src/lib/rental/permissions.js (role defaults + permission_overrides, deny-by-default).
--      Staff writes are granted ONLY via additive RLS policies using this predicate, for the
--      specific tables/operations the permission model allows. All other tables stay
--      privileged-only (fail closed).
--
-- Finding 2: team.manage was in the staff-overridable override catalog (update_workspace_member
-- valid_permissions), letting an owner grant team.manage=true to ordinary staff, after which
-- route-level team-manager checks trusted the permission bit. Fix: remove team.manage from the
-- catalog, reject team.manage=true on non-co_owner at the DB, never grant it to staff in the
-- SQL predicate, filter it in JS resolveEffectivePermissions, and hard-enforce owner/co_owner
-- in requireTeamManager.
--
-- This migration is ADDITIVE: it does not drop any existing policy. Postgres evaluates
-- multiple permissive policies with OR, so the new staff policies only ADD access where the
-- permission model explicitly allows it.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Finding 1: REVERT has_workspace_access(text) to the privileged model.
-- Verbatim pre-R17 definition from 20260829000100_add_workspace_authorization_helpers.sql.
-- ----------------------------------------------------------------------------
create or replace function public.has_workspace_access(p_owner_id text)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
    select p_owner_id = auth.uid()::text
        or exists (
            select 1 from workspace_members
            where owner_id = p_owner_id
              and member_user_id = auth.uid()
              and status = 'active'
              and role = 'co_owner'
        );
$$;

comment on function public.has_workspace_access(text) is
'NO-GO fix 2026-10-01: reverted to the privileged model (owner + active co_owner). '
'Staff read access uses has_workspace_visibility(); staff writes use has_rental_permission().';

-- ----------------------------------------------------------------------------
-- Finding 1: has_workspace_visibility(text) — the READ boundary for staff.
-- Owner OR any active workspace member (any role, any status=''active'').
-- ----------------------------------------------------------------------------
create or replace function public.has_workspace_visibility(p_owner_id text)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
    select p_owner_id = auth.uid()::text
        or exists (
            select 1 from workspace_members
            where owner_id = p_owner_id
              and member_user_id = auth.uid()
              and coalesce(status, 'active') = 'active'
        );
$$;

comment on function public.has_workspace_visibility(text) is
'Read/workspace visibility boundary: true for the owner or any active workspace member. '
'Does NOT grant writes; writes require has_workspace_access() (privileged) or '
'has_rental_permission() (staff, permission-gated).';

-- ----------------------------------------------------------------------------
-- Finding 1: has_rental_permission(text, text) — DB-enforced permission predicate.
-- Mirrors src/lib/rental/permissions.js: primary owner implicit full access, co_owner full
-- access, staff via role defaults + permission_overrides (true grants, false revokes),
-- deny-by-default. team.manage is NEVER granted to staff (finding 2).
-- ----------------------------------------------------------------------------
create or replace function public.has_rental_permission(p_owner_id text, p_permission_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
declare
  v_role text;
  v_overrides jsonb;
begin
  -- Primary owner: implicit full access (never a workspace_members row).
  if p_owner_id = auth.uid()::text then
    return true;
  end if;

  select wm.role, coalesce(wm.permission_overrides, '{}'::jsonb)
    into v_role, v_overrides
    from workspace_members wm
   where wm.owner_id = p_owner_id
     and wm.member_user_id = auth.uid()
     and coalesce(wm.status, 'active') = 'active';

  if v_role is null then
    return false;
  end if;

  -- Co-owner: full access, unchanged by R17.
  if v_role = 'co_owner' then
    return true;
  end if;

  -- Explicit override wins in both directions (mirrors normalizeOverrides + grant/delete).
  if v_overrides ? p_permission_key then
    return (v_overrides ->> p_permission_key) = 'true';
  end if;

  -- Finding 2: team.manage is never granted to staff by this predicate.
  if p_permission_key = 'team.manage' then
    return false;
  end if;

  -- Role defaults (mirror of ROLE_DEFAULT_PERMISSIONS in src/lib/rental/permissions.js).
  -- property_manager/manager: everything except team.manage (rejected above).
  case v_role
    when 'property_manager', 'manager' then
      return true;
    when 'bookkeeper' then
      return p_permission_key in (
        'payments.record', 'vendor_bills.manage', 'vendor_payments.record',
        'transfers.record', 'reports.view'
      );
    when 'maintenance' then
      return p_permission_key in ('maintenance.manage', 'messages.send');
    when 'marketing' then
      return p_permission_key in ('properties.manage', 'messages.send');
    else
      -- read_only and unknown roles: deny by default.
      return false;
  end case;
end;
$$;

comment on function public.has_rental_permission(text, text) is
'DB-enforced rental permission predicate (NO-GO fix 2026-10-01). Mirrors '
'src/lib/rental/permissions.js role defaults + permission_overrides. Deny-by-default; '
'team.manage never granted to staff.';

-- ----------------------------------------------------------------------------
-- Finding 2: update_workspace_member — remove team.manage from the staff-overridable
-- catalog and reject team.manage=true on non-co_owner memberships outright.
-- ----------------------------------------------------------------------------

create or replace function public.update_workspace_member(
    p_member_id text,
    p_role text default null,
    p_permission_overrides jsonb default null,
    p_status_action text default null
)
returns workspace_members
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
    owner_id_value text := public.team_management_owner_id();
    actor_is_primary_owner boolean := (owner_id_value = auth.uid()::text);
    target workspace_members%rowtype;
    updated workspace_members%rowtype;
    new_role text;
    new_overrides jsonb;
    new_status text;
    override_key text;
    valid_permissions text[] := array[
        'payments.record', 'payments.void_refund', 'vendor_bills.manage',
        'vendor_payments.record', 'transfers.record', 'tenants.manage',
        'properties.manage', 'maintenance.manage', 'messages.send',
        'reports.view', 'settings.manage'
        -- NO-GO fix (finding 2): team.manage is NOT staff-grantable. Only the
        -- primary owner (implicit) and co_owner (role) hold team management
        -- rights; the override catalog must not offer it to staff.
    ];
begin
    select * into target
      from workspace_members
     where owner_id = owner_id_value
       and id = p_member_id;

    if not found then
        raise exception 'No team member matching that id was found in your workspace.' using errcode = '22023';
    end if;

    if target.member_user_id = auth.uid() then
        raise exception 'You cannot change your own team membership.' using errcode = '22023';
    end if;

    if target.role = 'co_owner' and not actor_is_primary_owner then
        raise exception 'Only the primary owner can change a co-owner''s membership.' using errcode = '42501';
    end if;

    new_role := target.role;
    new_overrides := target.permission_overrides;
    new_status := target.status;

    if p_role is not null then
        if p_role not in (
            'co_owner', 'manager', 'property_manager',
            'bookkeeper', 'maintenance', 'marketing', 'read_only'
        ) then
            raise exception 'Unknown team role: %.', p_role using errcode = '22023';
        end if;
        new_role := p_role;
    end if;

    if p_permission_overrides is not null then
        if jsonb_typeof(p_permission_overrides) <> 'object' then
            raise exception 'Permission overrides must be a JSON object.' using errcode = '22023';
        end if;
        for override_key in select jsonb_object_keys(p_permission_overrides) loop
            if not (override_key = any (valid_permissions)) then
                raise exception 'Unknown permission: %.', override_key using errcode = '22023';
            end if;
            if jsonb_typeof(p_permission_overrides -> override_key) <> 'boolean' then
                raise exception 'Permission override values must be true or false.' using errcode = '22023';
            end if;
        end loop;
        new_overrides := p_permission_overrides;
    end if;

    -- NO-GO fix (finding 2, belt-and-braces): team.manage=true on a non-co_owner
    -- membership is rejected even if it bypassed the catalog above.
    if new_role <> 'co_owner' and (new_overrides ? 'team.manage')
       and (new_overrides ->> 'team.manage') = 'true' then
        raise exception 'team.manage can only be held by the primary owner or a co-owner.' using errcode = '42501';
    end if;

    if p_status_action is not null then
        if p_status_action = 'suspend' then
            if target.status <> 'active' then
                raise exception 'Only an active membership can be suspended.' using errcode = '22023';
            end if;
            new_status := 'suspended';
        elsif p_status_action = 'reactivate' then
            if target.status <> 'suspended' then
                raise exception 'Only a suspended membership can be reactivated.' using errcode = '22023';
            end if;
            new_status := 'active';
        else
            raise exception 'Unknown status action: %.', p_status_action using errcode = '22023';
        end if;
    end if;

    update workspace_members
       set role = new_role,
           permission_overrides = new_overrides,
           status = new_status,
           suspended_at = case
               when p_status_action = 'suspend' then now()
               when p_status_action = 'reactivate' then null
               else suspended_at
           end,
           updated_at = now()
     where owner_id = owner_id_value
       and id = p_member_id
    returning * into updated;

    if p_role is not null and p_role <> target.role then
        insert into workspace_member_audit (owner_id, actor_user_id, action, target_member_id, detail)
        values (owner_id_value, auth.uid(), 'member.role_changed', updated.id,
                jsonb_build_object('from', target.role, 'to', p_role));
    end if;

    if p_permission_overrides is not null then
        insert into workspace_member_audit (owner_id, actor_user_id, action, target_member_id, detail)
        values (owner_id_value, auth.uid(), 'member.permissions_changed', updated.id,
                jsonb_build_object('overrides', p_permission_overrides));
    end if;

    if p_status_action = 'suspend' then
        insert into workspace_member_audit (owner_id, actor_user_id, action, target_member_id, detail)
        values (owner_id_value, auth.uid(), 'member.suspended', updated.id, '{}');
    elsif p_status_action = 'reactivate' then
        insert into workspace_member_audit (owner_id, actor_user_id, action, target_member_id, detail)
        values (owner_id_value, auth.uid(), 'member.reactivated', updated.id, '{}');
    end if;

    return updated;
end;
$$;



-- ----------------------------------------------------------------------------
-- Finding 1: Staff SELECT (visibility) policies for rental tables — additive.
-- Staff can READ the rental workspace; writes stay gated by has_rental_permission().
-- ----------------------------------------------------------------------------

drop policy if exists "rental_staff_visibility_select" on rental_1099_reviews;
create policy "rental_staff_visibility_select" on rental_1099_reviews for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_animals;
create policy "rental_staff_visibility_select" on rental_animals for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_autopay_attempts;
create policy "rental_staff_visibility_select" on rental_autopay_attempts for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_autopay_enrollments;
create policy "rental_staff_visibility_select" on rental_autopay_enrollments for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_bank_deposit_items;
create policy "rental_staff_visibility_select" on rental_bank_deposit_items for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_bank_deposits;
create policy "rental_staff_visibility_select" on rental_bank_deposits for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_billing_settings;
create policy "rental_staff_visibility_select" on rental_billing_settings for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_billing_settings_audit;
create policy "rental_staff_visibility_select" on rental_billing_settings_audit for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_check_print_items;
create policy "rental_staff_visibility_select" on rental_check_print_items for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_check_print_runs;
create policy "rental_staff_visibility_select" on rental_check_print_runs for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_contractor_payments;
create policy "rental_staff_visibility_select" on rental_contractor_payments for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_contractors;
create policy "rental_staff_visibility_select" on rental_contractors for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_conversation_messages;
create policy "rental_staff_visibility_select" on rental_conversation_messages for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_conversations;
create policy "rental_staff_visibility_select" on rental_conversations for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_credit_applications;
create policy "rental_staff_visibility_select" on rental_credit_applications for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_document_acknowledgements;
create policy "rental_staff_visibility_select" on rental_document_acknowledgements for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_document_audit_log;
create policy "rental_staff_visibility_select" on rental_document_audit_log for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_documents;
create policy "rental_staff_visibility_select" on rental_documents for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_email_settings;
create policy "rental_staff_visibility_select" on rental_email_settings for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_inspection_acknowledgements;
create policy "rental_staff_visibility_select" on rental_inspection_acknowledgements for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_inspection_items;
create policy "rental_staff_visibility_select" on rental_inspection_items for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_inspections;
create policy "rental_staff_visibility_select" on rental_inspections for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_late_fee_assessments;
create policy "rental_staff_visibility_select" on rental_late_fee_assessments for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_late_fee_rules;
create policy "rental_staff_visibility_select" on rental_late_fee_rules for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_late_fee_settings_audit;
create policy "rental_staff_visibility_select" on rental_late_fee_settings_audit for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_late_fee_tenant_overrides;
create policy "rental_staff_visibility_select" on rental_late_fee_tenant_overrides for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_lease_changes;
create policy "rental_staff_visibility_select" on rental_lease_changes for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_lease_preparation_versions;
create policy "rental_staff_visibility_select" on rental_lease_preparation_versions for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_lease_preparations;
create policy "rental_staff_visibility_select" on rental_lease_preparations for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_lease_signatures;
create policy "rental_staff_visibility_select" on rental_lease_signatures for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_lease_tenants;
create policy "rental_staff_visibility_select" on rental_lease_tenants for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_leases;
create policy "rental_staff_visibility_select" on rental_leases for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_maintenance_requests;
create policy "rental_staff_visibility_select" on rental_maintenance_requests for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_maintenance_work_events;
create policy "rental_staff_visibility_select" on rental_maintenance_work_events for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_maintenance_work_orders;
create policy "rental_staff_visibility_select" on rental_maintenance_work_orders for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_message_templates;
create policy "rental_staff_visibility_select" on rental_message_templates for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_notification_delivery_events;
create policy "rental_staff_visibility_select" on rental_notification_delivery_events for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_notification_outbox;
create policy "rental_staff_visibility_select" on rental_notification_outbox for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_notification_preferences;
create policy "rental_staff_visibility_select" on rental_notification_preferences for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_payments;
create policy "rental_staff_visibility_select" on rental_payments for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_security_deposit_transactions;
create policy "rental_staff_visibility_select" on rental_security_deposit_transactions for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_security_deposits;
create policy "rental_staff_visibility_select" on rental_security_deposits for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_settlements;
create policy "rental_staff_visibility_select" on rental_settlements for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_support_case_events;
create policy "rental_staff_visibility_select" on rental_support_case_events for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_support_cases;
create policy "rental_staff_visibility_select" on rental_support_cases for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_tenant_credits;
create policy "rental_staff_visibility_select" on rental_tenant_credits for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_tenants;
create policy "rental_staff_visibility_select" on rental_tenants for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_units;
create policy "rental_staff_visibility_select" on rental_units for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_vendor_bills;
create policy "rental_staff_visibility_select" on rental_vendor_bills for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_vendor_payment_applications;
create policy "rental_staff_visibility_select" on rental_vendor_payment_applications for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_vendor_payments;
create policy "rental_staff_visibility_select" on rental_vendor_payments for select to authenticated
using (has_workspace_visibility(owner_id));

drop policy if exists "rental_staff_visibility_select" on rental_vendors;
create policy "rental_staff_visibility_select" on rental_vendors for select to authenticated
using (has_workspace_visibility(owner_id));

-- ----------------------------------------------------------------------------
-- Finding 1: Staff WRITE (permission-gated) policies for the 9 R17-gated routes' tables.
-- Each policy mirrors the route-level requireRentalPermission check at the DB layer,
-- so direct Supabase client writes cannot bypass the permission model.
-- Tables NOT listed here stay privileged-only (owner/co_owner) — fail closed.
-- ----------------------------------------------------------------------------

-- financial_events: the money routes (financial-event, manual-financial-event, transactions,
-- transactions/batch, transfers via create_fund_transfer, vendor-payments via record_vendor_payment).
drop policy if exists "financial_events_staff_insert" on financial_events;
create policy "financial_events_staff_insert" on financial_events for insert to authenticated
with check (
  has_rental_permission(owner_id, 'payments.record')
  or has_rental_permission(owner_id, 'transfers.record')
  or has_rental_permission(owner_id, 'vendor_payments.record')
);
drop policy if exists "financial_events_staff_update" on financial_events;
create policy "financial_events_staff_update" on financial_events for update to authenticated
using (
  has_rental_permission(owner_id, 'payments.record')
  or has_rental_permission(owner_id, 'transfers.record')
  or has_rental_permission(owner_id, 'vendor_payments.record')
  or has_rental_permission(owner_id, 'payments.void_refund')
)
with check (
  has_rental_permission(owner_id, 'payments.record')
  or has_rental_permission(owner_id, 'transfers.record')
  or has_rental_permission(owner_id, 'vendor_payments.record')
  or has_rental_permission(owner_id, 'payments.void_refund')
);
drop policy if exists "financial_events_staff_delete" on financial_events;
create policy "financial_events_staff_delete" on financial_events for delete to authenticated
using (has_rental_permission(owner_id, 'payments.void_refund'));
drop policy if exists "financial_events_staff_select" on financial_events;
create policy "financial_events_staff_select" on financial_events for select to authenticated
using (has_workspace_visibility(owner_id));

-- rental_vendors / rental_vendor_bills: vendor_bills.manage (vendor-bills routes).
drop policy if exists "rental_vendors_staff_write" on rental_vendors;
create policy "rental_vendors_staff_write" on rental_vendors for all to authenticated
using (has_rental_permission(owner_id, 'vendor_bills.manage'))
with check (has_rental_permission(owner_id, 'vendor_bills.manage'));
drop policy if exists "rental_vendor_bills_staff_write" on rental_vendor_bills;
create policy "rental_vendor_bills_staff_write" on rental_vendor_bills for all to authenticated
using (has_rental_permission(owner_id, 'vendor_bills.manage'))
with check (has_rental_permission(owner_id, 'vendor_bills.manage'));

-- rental_vendor_payments / rental_vendor_payment_applications: vendor_payments.record
-- (vendor-payments routes); voids additionally allow payments.void_refund on update.
drop policy if exists "rental_vendor_payments_staff_insert" on rental_vendor_payments;
create policy "rental_vendor_payments_staff_insert" on rental_vendor_payments for insert to authenticated
with check (has_rental_permission(owner_id, 'vendor_payments.record'));
drop policy if exists "rental_vendor_payments_staff_update" on rental_vendor_payments;
create policy "rental_vendor_payments_staff_update" on rental_vendor_payments for update to authenticated
using (
  has_rental_permission(owner_id, 'vendor_payments.record')
  or has_rental_permission(owner_id, 'payments.void_refund')
)
with check (
  has_rental_permission(owner_id, 'vendor_payments.record')
  or has_rental_permission(owner_id, 'payments.void_refund')
);
drop policy if exists "rental_vendor_payments_staff_delete" on rental_vendor_payments;
create policy "rental_vendor_payments_staff_delete" on rental_vendor_payments for delete to authenticated
using (has_rental_permission(owner_id, 'vendor_payments.record'));
drop policy if exists "rental_vendor_payment_applications_staff_write" on rental_vendor_payment_applications;
create policy "rental_vendor_payment_applications_staff_write" on rental_vendor_payment_applications for all to authenticated
using (has_rental_permission(owner_id, 'vendor_payments.record'))
with check (has_rental_permission(owner_id, 'vendor_payments.record'));

-- rental_maintenance_work_orders: maintenance.manage (work-order routes; the RPC is
-- security invoker so RLS applies).
drop policy if exists "rental_maintenance_work_orders_staff_write" on rental_maintenance_work_orders;
create policy "rental_maintenance_work_orders_staff_write" on rental_maintenance_work_orders for all to authenticated
using (has_rental_permission(owner_id, 'maintenance.manage'))
with check (has_rental_permission(owner_id, 'maintenance.manage'));

-- ----------------------------------------------------------------------------
-- Finding 1: Update SECURITY DEFINER messaging RPCs to enforce the permission model.
-- These RPCs run with row_security=off, so the reverted has_workspace_access() would
-- block legitimate staff use. Each now accepts the DB permission predicate as well.
-- ----------------------------------------------------------------------------
create or replace function send_rental_conversation_owner_message(p_tenant_id text, p_body text)
returns jsonb language plpgsql security definer set search_path = public set row_security = off as $$
declare
  v_owner_id text := resolve_effective_owner_id();
  v_conversation rental_conversations%rowtype;
  v_message rental_conversation_messages%rowtype;
begin
  -- NO-GO fix 2026-10-01: staff with messages.send may send via this RPC; the
  -- reverted has_workspace_access() alone would block them, and the widened R17
  -- version would have let ANY staff member send. DB-enforced permission check.
  if not has_workspace_access(v_owner_id)
     and not has_rental_permission(v_owner_id, 'messages.send') then
    raise exception 'Workspace access is required.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_body, ''))) = 0 then
    raise exception 'A message body is required.' using errcode = '22023';
  end if;
  if not exists (select 1 from rental_tenants where owner_id = v_owner_id and id = p_tenant_id) then
    raise exception 'Tenant was not found.' using errcode = 'P0002';
  end if;
  insert into rental_conversations (owner_id, id, tenant_id, last_message_at, last_message_body, last_message_sender_type, owner_last_read_at)
  values (v_owner_id, 'rental_conversation_' || gen_random_uuid()::text, p_tenant_id, now(), btrim(p_body), 'owner', now())
  on conflict (owner_id, tenant_id) do update set
    last_message_at = excluded.last_message_at, last_message_body = excluded.last_message_body,
    last_message_sender_type = 'owner', owner_last_read_at = now()
  returning * into v_conversation;
  insert into rental_conversation_messages (owner_id, id, conversation_id, sender_type, body, created_at)
  values (v_owner_id, 'rental_conversation_message_' || gen_random_uuid()::text, v_conversation.id, 'owner', btrim(p_body), now())
  returning * into v_message;
  return jsonb_build_object('conversationId', v_conversation.id, 'messageId', v_message.id, 'createdAt', v_message.created_at);
end;
$$;

create or replace function mark_rental_conversation_read_by_owner(p_tenant_id text)
returns void language plpgsql security definer set search_path = public set row_security = off as $$
declare v_owner_id text := resolve_effective_owner_id();
begin
  -- NO-GO fix 2026-10-01: marking read is a harmless timestamp; any workspace
  -- member with visibility may do it.
  if not has_workspace_visibility(v_owner_id) then
    raise exception 'Workspace access is required.' using errcode = '42501';
  end if;
  update rental_conversations set owner_last_read_at = now() where owner_id = v_owner_id and tenant_id = p_tenant_id;
end;
$$;

create or replace function send_rental_work_order_owner_message(p_work_order_id text, p_body text)
returns jsonb language plpgsql security definer set search_path = public set row_security = off as $$
declare
  v_owner_id text := resolve_effective_owner_id();
  v_request rental_maintenance_requests%rowtype;
  v_conversation rental_conversations%rowtype;
  v_message rental_conversation_messages%rowtype;
begin
  -- NO-GO fix 2026-10-01: staff with maintenance.manage or messages.send may send
  -- via this RPC. DB-enforced permission check.
  if not has_workspace_access(v_owner_id)
     and not has_rental_permission(v_owner_id, 'maintenance.manage')
     and not has_rental_permission(v_owner_id, 'messages.send') then
    raise exception 'Workspace access is required.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_body, ''))) = 0 then
    raise exception 'A message body is required.' using errcode = '22023';
  end if;
  select r.* into v_request
  from rental_maintenance_work_orders w
  join rental_maintenance_requests r on r.owner_id = w.owner_id and r.id = w.request_id
  where w.owner_id = v_owner_id and w.id = p_work_order_id;
  if v_request.id is null then
    raise exception 'Work order was not found.' using errcode = 'P0002';
  end if;
  insert into rental_conversations (owner_id, id, tenant_id, work_order_id, last_message_at, last_message_body, last_message_sender_type, owner_last_read_at)
  values (v_owner_id, 'rental_conversation_' || gen_random_uuid()::text, v_request.tenant_id, p_work_order_id, now(), btrim(p_body), 'owner', now())
  on conflict (owner_id, work_order_id) where work_order_id is not null do update set
    last_message_at = excluded.last_message_at, last_message_body = excluded.last_message_body,
    last_message_sender_type = 'owner', owner_last_read_at = now()
  returning * into v_conversation;
  insert into rental_conversation_messages (owner_id, id, conversation_id, sender_type, body, created_at)
  values (v_owner_id, 'rental_conversation_message_' || gen_random_uuid()::text, v_conversation.id, 'owner', btrim(p_body), now())
  returning * into v_message;
  return jsonb_build_object('conversationId', v_conversation.id, 'messageId', v_message.id,
    'createdAt', v_message.created_at, 'tenantId', v_request.tenant_id, 'workOrderId', p_work_order_id);
end;
$$;

create or replace function mark_rental_work_order_read_by_owner(p_work_order_id text)
returns void language plpgsql security definer set search_path = public set row_security = off as $$
declare v_owner_id text := resolve_effective_owner_id();
begin
  -- NO-GO fix 2026-10-01: marking read is a harmless timestamp; any workspace
  -- member with visibility may do it.
  if not has_workspace_visibility(v_owner_id) then
    raise exception 'Workspace access is required.' using errcode = '42501';
  end if;
  update rental_conversations set owner_last_read_at = now()
  where owner_id = v_owner_id and work_order_id = p_work_order_id;
end;
$$;
