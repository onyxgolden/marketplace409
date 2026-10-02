-- ============================================================================
-- Rentec parity R17/R18: atomic vendor-bill un-void RPC (PR #522 CHANGES fix).
--
-- Problem (ChatGPT 2026-10-01): the PATCH /api/rental/vendor-bills/[id]
-- un-void path reopened the bill in one request and inserted the
-- rental_void_audits row in a second request. Staff holding
-- vendor_bills.manage can UPDATE rental_vendor_bills (R17 staff_write policy)
-- but cannot INSERT into rental_void_audits (its policy still requires
-- has_workspace_access, i.e. owner / active co_owner). The audit INSERT would
-- fail with HTTP 500 AFTER the bill was already reopened — a reopened bill
-- with no reason/actor history, unrecoverable through the same operation.
--
-- Fix: a narrowly authorized SECURITY DEFINER RPC that performs the bill
-- status transition AND the audit append inside one transaction, so either
-- both commit or neither does. Authorization is checked inside the RPC via
-- has_rental_permission(owner_id, 'vendor_bills.manage') — no broad staff
-- workspace writes are restored.
-- ============================================================================

create or replace function public.unvoid_vendor_bill(
  p_owner_id text,
  p_bill_id text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id text := auth.uid()::text;
  v_bill rental_vendor_bills%rowtype;
  v_reason text;
begin
  if v_actor_id is null then
    raise exception 'Authenticated user is required.'
      using errcode = '42501';
  end if;

  if p_owner_id is null or btrim(p_owner_id) = '' then
    raise exception 'Owner id is required.'
      using errcode = '22023';
  end if;

  if p_bill_id is null or btrim(p_bill_id) = '' then
    raise exception 'Bill id is required.'
      using errcode = '22023';
  end if;

  -- Narrow authorization: the caller must hold vendor_bills.manage for this
  -- workspace. This covers the primary owner, active co_owners, and staff
  -- explicitly granted the permission — nobody else.
  if not public.has_rental_permission(p_owner_id, 'vendor_bills.manage') then
    raise exception 'Missing vendor_bills.manage permission.'
      using errcode = '42501';
  end if;

  v_reason := btrim(p_reason);
  if v_reason = '' then
    raise exception 'A reason is required to un-void a bill.'
      using errcode = '22023';
  end if;
  v_reason := left(v_reason, 500);

  -- Write-time guard: the bill must still be voided AND untouched (zero
  -- applied payments). A payment landing between the read and the write must
  -- not be silently resurrected. Zero rows updated = the bill changed → the
  -- caller treats this as a 409 conflict.
  update rental_vendor_bills
     set status = 'open',
         updated_at = now()
   where owner_id = p_owner_id
     and id = p_bill_id
     and status = 'voided'
     and paid_amount_cents = 0
  returning * into v_bill;

  if not found then
    raise exception 'Bill is not in a voided, untouched state.'
      using errcode = 'P0001';
  end if;

  -- Audit append, same transaction: either both the reopen and the audit
  -- commit, or neither does. SECURITY DEFINER bypasses the
  -- has_workspace_access INSERT policy on rental_void_audits, which is safe
  -- here because the permission check above already authorized this exact
  -- operation.
  insert into rental_void_audits (
    owner_id, entity_type, entity_id, action, reason, actor_id
  ) values (
    p_owner_id, 'vendor_bill', p_bill_id, 'unvoid', v_reason, v_actor_id
  );

  return jsonb_build_object(
    'id', v_bill.id,
    'status', v_bill.status,
    'updated_at', v_bill.updated_at
  );
end;
$$;

comment on function public.unvoid_vendor_bill(text, text, text) is
'R17/R18 atomic vendor-bill un-void (PR #522): reopens a voided untouched bill and appends the rental_void_audits row in one transaction. Authorized via has_rental_permission(vendor_bills.manage).';

-- The RPC is intentionally NOT granted to anon; authenticated callers reach it
-- through PostgREST only after the permission check inside the function body.
revoke all on function public.unvoid_vendor_bill(text, text, text) from public, anon;
grant execute on function public.unvoid_vendor_bill(text, text, text) to authenticated;
