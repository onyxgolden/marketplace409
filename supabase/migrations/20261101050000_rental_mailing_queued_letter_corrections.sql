-- Controls-sweep follow-up G25 (O-24): queued-letter corrections. A letter
-- queued to a wrong address can have its recipient address corrected, and
-- a queued letter can be deleted outright. Mailed/delivered letters are
-- delivery evidence and are never editable or deletable through this path
-- (the route gates delete to queued the same way).
--
-- The correction is its own RPC rather than an extension of
-- update_mailing_letter_atomic: the atomic path stays compliance-critical
-- and untouched, and this RPC carries its own compare-and-swap on the
-- address plus a 'recipient_changed' audit event (so the event_type CHECK
-- is widened below — the same additive pattern R17 used for the role CHECK).
do $$
declare
  constraint_name_value text;
begin
  select conname into constraint_name_value
    from pg_constraint
   where conrelid = 'rental_mail_letter_events'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%event_type%';
  if constraint_name_value is not null then
    execute format('alter table rental_mail_letter_events drop constraint %I', constraint_name_value);
  end if;
end
$$;
alter table rental_mail_letter_events
  add constraint rental_mail_letter_events_event_type_check
  check (event_type in ('status_changed', 'tracking_set', 'tracking_changed', 'tracking_cleared', 'recipient_changed'));

create or replace function public.correct_mailing_letter_recipient(
  p_owner_id text,
  p_letter_id text,
  p_expected_recipient text,
  p_next_recipient text
)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_actor_id text := auth.uid()::text;
  v_letter rental_mail_letters%rowtype;
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
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'Only the owner or co-owner can update mailings.'
      using errcode = '42501';
  end if;
  if p_next_recipient is null or btrim(p_next_recipient) = '' then
    raise exception 'A recipient address is required.'
      using errcode = '22023';
  end if;
  select * into v_letter
    from rental_mail_letters
   where owner_id = p_owner_id
     and id = p_letter_id
     for update;
  if not found then
    raise exception 'Letter was changed or deleted.'
      using errcode = 'P0001';
  end if;
  if v_letter.status <> 'queued' then
    raise exception 'Only a queued letter''s address can be corrected — a mailed letter''s address is delivery evidence.'
      using errcode = '22023';
  end if;
  if v_letter.recipient_address is distinct from p_expected_recipient then
    raise exception 'Letter was changed or deleted.'
      using errcode = 'P0001';
  end if;
  update rental_mail_letters
     set recipient_address = btrim(p_next_recipient),
         updated_at = now()
   where owner_id = p_owner_id
     and id = p_letter_id
  returning * into v_letter;
  insert into rental_mail_letter_events (
    owner_id, letter_id, event_type, actor_user_id, details
  ) values (
    p_owner_id, p_letter_id, 'recipient_changed', v_actor_id,
    jsonb_build_object('from', p_expected_recipient, 'to', btrim(p_next_recipient))
  );
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
revoke all on function public.correct_mailing_letter_recipient(text, text, text, text) from public, anon;
grant execute on function public.correct_mailing_letter_recipient(text, text, text, text) to authenticated;
