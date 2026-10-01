-- ============================================================================
-- Rentec parity R21: transactional application-decision RPC (PR #526 CHANGES fix).
--
-- Problem (ChatGPT 2026-10-01): POST /api/rental/applications/[id]/decision
-- performed the decision as a sequence of separate writes — load application,
-- insert tenant, insert lease, insert the lease/tenant link, update the
-- application status, insert the audit row. Two staff deciding the same
-- application at the same time could both pass the "status = pending" check
-- and both create tenants/leases, and a failure midway (e.g. the audit insert
-- failing after the tenant/lease were created) left orphaned records with no
-- decision history.
--
-- Fix: a narrowly authorized SECURITY DEFINER RPC that locks the application
-- row (FOR UPDATE), re-validates status = 'pending' under the lock, and then
-- performs the tenant insert + lease insert + link + status update + audit
-- append inside one transaction, so either everything commits or nothing does.
-- Authorization is checked inside the RPC via has_workspace_access(owner_id)
-- (owner / active co_owner only — read-only staff get 42501), so a direct
-- authenticated RPC call cannot bypass the route's role check.
-- ============================================================================

create or replace function public.decide_rental_application(
  p_owner_id text,
  p_application_id text,
  p_action text,
  p_reason text,
  p_tenant_display_name text,
  p_tenant_email text,
  p_tenant_phone text,
  p_lease_start_date date,
  p_lease_end_date date,
  p_monthly_rent_cents bigint,
  p_rent_due_day smallint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id text := auth.uid()::text;
  v_app rental_applications%rowtype;
  v_listing rental_listings%rowtype;
  v_tenant_id text;
  v_lease_id text;
  v_decision_id text;
  v_now timestamptz := now();
begin
  if v_actor_id is null then
    raise exception 'Authenticated user is required.'
      using errcode = '42501';
  end if;

  if p_owner_id is null or btrim(p_owner_id) = '' then
    raise exception 'Owner id is required.'
      using errcode = '22023';
  end if;

  -- Narrow authorization: owner or active co-owner only. has_workspace_access
  -- excludes read-only staff, so direct RPC calls cannot bypass the route.
  if not has_workspace_access(p_owner_id) then
    raise exception 'Deciding applications requires owner or co-owner access.'
      using errcode = '42501';
  end if;

  if p_action not in ('approve', 'deny') then
    raise exception 'Action must be approve or deny.'
      using errcode = '22023';
  end if;

  -- Serialize concurrent decisions on the same application: the row lock means
  -- exactly one decider proceeds; the loser sees the updated status and the
  -- route maps P0001 to HTTP 409.
  select * into v_app
    from rental_applications
    where owner_id = p_owner_id and id = p_application_id
    for update;
  if not found then
    raise exception 'Application was not found.'
      using errcode = 'P0001';
  end if;
  if v_app.status <> 'pending' then
    raise exception 'Only a pending application can be decided.'
      using errcode = 'P0001';
  end if;

  if p_action = 'deny' then
    if p_reason is null or btrim(p_reason) = '' then
      raise exception 'A denial reason is required — it is stored on the audit row.'
        using errcode = '22023';
    end if;

    update rental_applications
      set status = 'denied',
          denial_reason = btrim(p_reason),
          decided_by = v_actor_id,
          decided_at = v_now,
          updated_at = v_now
      where owner_id = p_owner_id and id = p_application_id;

    insert into rental_application_decisions(
      owner_id, application_id, action, reason, actor_user_id, created_at
    )
      values (p_owner_id, p_application_id, 'denied', btrim(p_reason), v_actor_id, v_now)
      returning id into v_decision_id;
  else
    -- Approve: inputs are validated by the route too, but the RPC is the trust
    -- boundary, so it validates independently.
    if p_tenant_display_name is null or btrim(p_tenant_display_name) = '' then
      raise exception 'A tenant display name is required to approve.'
        using errcode = '22023';
    end if;
    if p_tenant_email is null or btrim(p_tenant_email) = '' then
      raise exception 'A tenant email is required to approve.'
        using errcode = '22023';
    end if;
    if p_lease_start_date is null then
      raise exception 'A lease start date is required to approve.'
        using errcode = '22023';
    end if;
    if p_monthly_rent_cents is null or p_monthly_rent_cents <= 0 then
      raise exception 'A positive monthly rent is required to approve.'
        using errcode = '22023';
    end if;
    if p_rent_due_day is null or p_rent_due_day < 1 or p_rent_due_day > 28 then
      raise exception 'rentDueDay must be between 1 and 28.'
        using errcode = '22023';
    end if;

    select * into v_listing
      from rental_listings
      where owner_id = p_owner_id and id = v_app.listing_id;
    if not found then
      raise exception 'The listing for this application no longer exists.'
        using errcode = 'P0001';
    end if;

    v_tenant_id := 'rental_tenant_' || gen_random_uuid()::text;
    v_lease_id := 'rental_lease_' || gen_random_uuid()::text;

    -- unique(owner_id, email) raises 23505 on duplicates; the route maps it to
    -- HTTP 409 ("merge with the existing record first").
    insert into rental_tenants(
      owner_id, id, display_name, email, phone, status, created_at, updated_at
    )
      values (
        p_owner_id, v_tenant_id,
        btrim(p_tenant_display_name), lower(btrim(p_tenant_email)),
        nullif(btrim(coalesce(p_tenant_phone, '')), ''),
        'applicant', v_now, v_now
      );

    insert into rental_leases(
      owner_id, id, property_id, unit_id, status, start_date, end_date,
      monthly_rent_cents, currency_code, rent_due_day, notes, created_at, updated_at
    )
      values (
        p_owner_id, v_lease_id, v_listing.property_id, v_listing.unit_id, 'draft',
        p_lease_start_date, p_lease_end_date, p_monthly_rent_cents, 'USD', p_rent_due_day,
        'Created from rental application ' || p_application_id || '.', v_now, v_now
      );

    insert into rental_lease_tenants(owner_id, lease_id, tenant_id, created_at)
      values (p_owner_id, v_lease_id, v_tenant_id, v_now);

    update rental_applications
      set status = 'approved',
          tenant_id = v_tenant_id,
          lease_id = v_lease_id,
          decided_by = v_actor_id,
          decided_at = v_now,
          updated_at = v_now
      where owner_id = p_owner_id and id = p_application_id;

    insert into rental_application_decisions(
      owner_id, application_id, action, actor_user_id, tenant_id, lease_id, created_at
    )
      values (p_owner_id, p_application_id, 'approved', v_actor_id, v_tenant_id, v_lease_id, v_now)
      returning id into v_decision_id;
  end if;

  return jsonb_build_object(
    'decision_id', v_decision_id,
    'action', case when p_action = 'approve' then 'approved' else 'denied' end,
    'tenant_id', v_tenant_id,
    'lease_id', v_lease_id
  );
end;
$$;

-- Narrow grant: authenticated callers only. The function enforces its own
-- authorization (owner/co-owner via has_workspace_access); anon gets nothing.
revoke all on function public.decide_rental_application(
  text, text, text, text, text, text, text, date, date, bigint, smallint
) from public, anon;
grant execute on function public.decide_rental_application(
  text, text, text, text, text, text, text, date, date, bigint, smallint
) to authenticated;
