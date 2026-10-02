-- ============================================================================
-- Rentec parity R20: atomic mailing-letter mutation + audit RPC (PR #525
-- ChatGPT GO WITH FIXES fix).
--
-- Problem (ChatGPT 2026-10-01): the PATCH /api/rental/mailing/letters/[id]
-- route updated the rental_mail_letters row in one request and stamped the
-- rental_mail_letter_events audit rows afterwards in a separate,
-- failure-swallowed call. If the event INSERT failed, the status/tracking
-- correction committed WITHOUT its audit row — contradicting the claim that
-- every status/tracking change is stamped into the compliance audit trail.
--
-- Fix: a narrowly authorized SECURITY DEFINER RPC that performs the letter
-- mutation AND the audit event insert(s) inside one transaction, so either
-- everything commits or nothing does. Authorization is checked inside the
-- RPC via has_workspace_access(owner_id) — the primary owner or an active
-- co_owner, exactly the route's isOwnerOrActiveCoOwner population; staff
-- roles (manager, bookkeeper, read_only) are excluded.
--
-- Concurrency: the RPC locks the letter FOR UPDATE and re-checks that its
-- status and tracking number still match what the caller read
-- (compare-and-swap). A letter changed between the route's read and the
-- write raises P0001, which the route maps to HTTP 409.
--
-- The database check constraint rental_mail_letters_tracking_required_for_mailed
-- (20261001120000) independently backs the certified-mail evidence invariant
-- inside the same transaction.
--
-- AUTHORED, NOT APPLIED. Jason applies migrations.
-- ============================================================================

create or replace function public.update_mailing_letter_atomic(
  p_owner_id text,
  p_letter_id text,
  p_expected_status text,
  p_expected_tracking text,
  p_next_status text,
  p_tracking_touched boolean,
  p_next_tracking text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id text := auth.uid()::text;
  v_letter rental_mail_letters%rowtype;
  v_event_type text;
begin
  if v_actor_id is null then
    raise exception 'Authenticated user is required.'
      using errcode = '42501';
  end if;

  if p_owner_id is null or btrim(p_owner_id) = '' then
    raise exception 'Owner id is required.'
      using errcode = '22023';
  end if;

  if p_letter_id is null or btrim(p_letter_id) = '' then
    raise exception 'Letter id is required.'
      using errcode = '22023';
  end if;

  -- Narrow authorization: the primary owner or an active co_owner of this
  -- workspace. Staff roles have no workspace access and are excluded here,
  -- matching the route's owner/co-owner write gate and the mailing RLS
  -- policies (which also use has_workspace_access).
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'Only the owner or co-owner can update mailings.'
      using errcode = '42501';
  end if;

  -- Defense in depth: the route already validates the status machine, but the
  -- RPC never accepts an out-of-vocabulary status.
  if p_next_status is not null and p_next_status not in ('queued', 'mailed', 'delivered') then
    raise exception 'Status must be one of: queued, mailed, delivered.'
      using errcode = '22023';
  end if;

  -- Lock the letter and compare-and-swap on what the caller read. A status
  -- or tracking change landing between the route's read and this write must
  -- not be silently overwritten.
  select * into v_letter
    from rental_mail_letters
   where owner_id = p_owner_id
     and id = p_letter_id
   for update;

  if not found then
    raise exception 'Letter was changed or deleted.'
      using errcode = 'P0001';
  end if;

  if v_letter.status is distinct from p_expected_status
     or v_letter.tracking_number is distinct from p_expected_tracking then
    raise exception 'Letter was changed or deleted.'
      using errcode = 'P0001';
  end if;

  -- Apply the mutation. mailed_at/delivered_at are derived from the status
  -- transition inside the RPC so the stamps can never disagree with the
  -- status that was actually written.
  update rental_mail_letters
     set status = coalesce(p_next_status, status),
         tracking_number = case when p_tracking_touched then p_next_tracking else tracking_number end,
         mailed_at = case
           when p_next_status = 'mailed' then now()
           when p_next_status = 'queued' then null
           else mailed_at
         end,
         delivered_at = case
           when p_next_status = 'delivered' then now()
           when p_next_status in ('queued', 'mailed') then null
           else delivered_at
         end,
         updated_at = now()
   where owner_id = p_owner_id
     and id = p_letter_id
  returning * into v_letter;

  -- Audit append, same transaction: the status/tracking correction and its
  -- compliance event rows commit or roll back together. There is no
  -- failure-swallowed stamp path anymore.
  if p_next_status is not null and p_next_status is distinct from p_expected_status then
    insert into rental_mail_letter_events (
      owner_id, letter_id, event_type, actor_user_id, details
    ) values (
      p_owner_id, p_letter_id, 'status_changed', v_actor_id,
      jsonb_build_object('from', p_expected_status, 'to', p_next_status)
    );
  end if;

  if coalesce(p_tracking_touched, false) then
    v_event_type := case
      when p_expected_tracking is null or btrim(p_expected_tracking) = '' then 'tracking_set'
      when p_next_tracking is null then 'tracking_cleared'
      else 'tracking_changed'
    end;
    insert into rental_mail_letter_events (
      owner_id, letter_id, event_type, actor_user_id, details
    ) values (
      p_owner_id, p_letter_id, v_event_type, v_actor_id,
      jsonb_build_object('from', p_expected_tracking, 'to', p_next_tracking)
    );
  end if;

  return jsonb_build_object(
    'id', v_letter.id,
    'batch_id', v_letter.batch_id,
    'template_id', v_letter.template_id,
    'tenant_id', v_letter.tenant_id,
    'tenant_name', v_letter.tenant_name,
    'recipient_address', v_letter.recipient_address,
    'return_address', v_letter.return_address,
    'subject', v_letter.subject,
    'body', v_letter.body,
    'letter_date', v_letter.letter_date,
    'status', v_letter.status,
    'tracking_number', v_letter.tracking_number,
    'mailed_at', v_letter.mailed_at,
    'delivered_at', v_letter.delivered_at,
    'document_id', v_letter.document_id,
    'created_at', v_letter.created_at
  );
end;
$$;

comment on function public.update_mailing_letter_atomic(text, text, text, text, text, boolean, text) is
'R20 atomic mailing-letter mutation (PR #525): applies the letter status/tracking change and stamps the rental_mail_letter_events audit rows in one transaction. Authorized via has_workspace_access (owner / active co_owner only).';

-- The RPC is intentionally NOT granted to anon; authenticated callers reach it
-- through PostgREST only after the authorization check inside the function body.
revoke all on function public.update_mailing_letter_atomic(text, text, text, text, text, boolean, text) from public, anon;
grant execute on function public.update_mailing_letter_atomic(text, text, text, text, text, boolean, text) to authenticated;
