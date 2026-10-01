-- Rentec parity R5: work-order messaging.
--
-- Rentec lets the owner message the tenant (and the tenant reply) from inside a work order.
-- FORGE already has in-portal conversation threads (rental_conversations /
-- rental_conversation_messages, added 2026-09-18) but they are one thread per tenant, with no
-- link to a work order. This slice reuses those exact tables: a work-order thread is a
-- conversation row with work_order_id set. No parallel messaging tables.
--
-- Schema changes to rental_conversations:
--   * new nullable work_order_id, FK to rental_maintenance_work_orders.
--   * the old unique(owner_id, tenant_id) becomes two partial unique indexes so a tenant can
--     have BOTH a general thread (work_order_id null) and one thread per work order.
--     The two pre-existing send RPCs are re-created with matching ON CONFLICT predicates, and
--     the two read-mark RPCs are re-created scoped to the general thread so opening one thread
--     no longer marks the other thread read.
--
-- New RPCs (same security-definer, identity-deriving pattern as the 2026-09-18 ones):
--   send_rental_work_order_owner_message / send_rental_work_order_tenant_message /
--   mark_rental_work_order_read_by_owner / mark_rental_work_order_read_by_tenant /
--   read_rental_work_order_tenant_messages / get_rental_owner_notification_email.
--
-- Notification: extends the rental_notification_outbox type check with 'work_order_message'.
-- The check is re-added with the FULL known set (the R2 slice's statement_emailed /
-- invoice_emailed included) so this migration is safe whether or not R2's migration has run.
-- NOTE for merge order: any later migration that drops/re-adds this check must carry the full
-- set forward, including 'work_order_message'.
--
-- Tenant portal: load_rental_maintenance_work_updates gains hasUnreadMessages per work order.

alter table rental_conversations add column if not exists work_order_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'rental_conversations_work_order_fk'
  ) then
    alter table rental_conversations
      add constraint rental_conversations_work_order_fk
      foreign key (owner_id, work_order_id)
      references rental_maintenance_work_orders (owner_id, id)
      on delete restrict;
  end if;
end $$;

alter table rental_conversations drop constraint if exists rental_conversations_owner_id_tenant_id_key;

create unique index if not exists uq_rental_conversations_general
  on rental_conversations (owner_id, tenant_id) where work_order_id is null;
create unique index if not exists uq_rental_conversations_work_order
  on rental_conversations (owner_id, work_order_id) where work_order_id is not null;
create index if not exists idx_rental_conversations_work_order
  on rental_conversations (owner_id, work_order_id);

-- Re-create the two pre-existing send RPCs with ON CONFLICT predicates matching the new
-- partial unique index (general thread only). Bodies are otherwise unchanged.
create or replace function send_rental_conversation_owner_message(p_tenant_id text, p_body text)
returns jsonb language plpgsql security definer set search_path = public set row_security = off as $$
declare
  v_owner_id text := resolve_effective_owner_id();
  v_conversation rental_conversations%rowtype;
  v_message rental_conversation_messages%rowtype;
begin
  if not has_workspace_access(v_owner_id) then
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
  on conflict (owner_id, tenant_id) where work_order_id is null do update set
    last_message_at = excluded.last_message_at, last_message_body = excluded.last_message_body,
    last_message_sender_type = 'owner', owner_last_read_at = now()
  returning * into v_conversation;
  insert into rental_conversation_messages (owner_id, id, conversation_id, sender_type, body, created_at)
  values (v_owner_id, 'rental_conversation_message_' || gen_random_uuid()::text, v_conversation.id, 'owner', btrim(p_body), now())
  returning * into v_message;
  return jsonb_build_object('conversationId', v_conversation.id, 'messageId', v_message.id, 'createdAt', v_message.created_at);
end;
$$;

create or replace function send_rental_conversation_tenant_message(p_body text, p_category text default null)
returns jsonb language plpgsql security definer set search_path = public set row_security = off as $$
declare
  v_tenant rental_tenants%rowtype;
  v_conversation rental_conversations%rowtype;
  v_message rental_conversation_messages%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  select * into v_tenant from rental_tenants where auth_user_id = auth.uid();
  if v_tenant.id is null then
    raise exception 'No tenant portal access is linked to this account.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_body, ''))) = 0 then
    raise exception 'A message body is required.' using errcode = '22023';
  end if;
  if p_category is not null and p_category not in ('issue', 'suggestion') then
    raise exception 'Invalid message category.' using errcode = '22023';
  end if;
  insert into rental_conversations (owner_id, id, tenant_id, last_message_at, last_message_body, last_message_sender_type, tenant_last_read_at)
  values (v_tenant.owner_id, 'rental_conversation_' || gen_random_uuid()::text, v_tenant.id, now(), btrim(p_body), 'tenant', now())
  on conflict (owner_id, tenant_id) where work_order_id is null do update set
    last_message_at = excluded.last_message_at, last_message_body = excluded.last_message_body,
    last_message_sender_type = 'tenant', tenant_last_read_at = now()
  returning * into v_conversation;
  insert into rental_conversation_messages (owner_id, id, conversation_id, sender_type, body, category, created_at)
  values (v_tenant.owner_id, 'rental_conversation_message_' || gen_random_uuid()::text, v_conversation.id, 'tenant', btrim(p_body), p_category, now())
  returning * into v_message;
  return jsonb_build_object('conversationId', v_conversation.id, 'messageId', v_message.id, 'createdAt', v_message.created_at);
end;
$$;

-- Re-create the read-mark RPCs scoped to the general thread: opening the general thread must
-- not mark work-order threads read, and vice versa.
create or replace function mark_rental_conversation_read_by_owner(p_tenant_id text)
returns void language plpgsql security definer set search_path = public set row_security = off as $$
declare v_owner_id text := resolve_effective_owner_id();
begin
  if not has_workspace_access(v_owner_id) then
    raise exception 'Workspace access is required.' using errcode = '42501';
  end if;
  update rental_conversations set owner_last_read_at = now()
  where owner_id = v_owner_id and tenant_id = p_tenant_id and work_order_id is null;
end;
$$;

create or replace function mark_rental_conversation_read_by_tenant()
returns void language plpgsql security definer set search_path = public set row_security = off as $$
declare v_tenant rental_tenants%rowtype;
begin
  select * into v_tenant from rental_tenants where auth_user_id = auth.uid();
  if v_tenant.id is null then
    raise exception 'No tenant portal access is linked to this account.' using errcode = '42501';
  end if;
  update rental_conversations set tenant_last_read_at = now()
  where owner_id = v_tenant.owner_id and tenant_id = v_tenant.id and work_order_id is null;
end;
$$;

-- Owner sends a message on a work order's thread. The tenant is derived from the work order's
-- request -- never trusted from the client.
create or replace function send_rental_work_order_owner_message(p_work_order_id text, p_body text)
returns jsonb language plpgsql security definer set search_path = public set row_security = off as $$
declare
  v_owner_id text := resolve_effective_owner_id();
  v_request rental_maintenance_requests%rowtype;
  v_conversation rental_conversations%rowtype;
  v_message rental_conversation_messages%rowtype;
begin
  if not has_workspace_access(v_owner_id) then
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

-- Tenant sends a message on a work order's thread. The work order must belong to a request the
-- tenant submitted -- a tenant can never message on another tenant's work order.
create or replace function send_rental_work_order_tenant_message(p_work_order_id text, p_body text)
returns jsonb language plpgsql security definer set search_path = public set row_security = off as $$
declare
  v_tenant rental_tenants%rowtype;
  v_request rental_maintenance_requests%rowtype;
  v_conversation rental_conversations%rowtype;
  v_message rental_conversation_messages%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  select * into v_tenant from rental_tenants where auth_user_id = auth.uid();
  if v_tenant.id is null then
    raise exception 'No tenant portal access is linked to this account.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_body, ''))) = 0 then
    raise exception 'A message body is required.' using errcode = '22023';
  end if;
  select r.* into v_request
  from rental_maintenance_work_orders w
  join rental_maintenance_requests r on r.owner_id = w.owner_id and r.id = w.request_id
  where w.owner_id = v_tenant.owner_id and w.id = p_work_order_id and r.tenant_id = v_tenant.id;
  if v_request.id is null then
    raise exception 'Work order was not found.' using errcode = 'P0002';
  end if;
  insert into rental_conversations (owner_id, id, tenant_id, work_order_id, last_message_at, last_message_body, last_message_sender_type, tenant_last_read_at)
  values (v_tenant.owner_id, 'rental_conversation_' || gen_random_uuid()::text, v_tenant.id, p_work_order_id, now(), btrim(p_body), 'tenant', now())
  on conflict (owner_id, work_order_id) where work_order_id is not null do update set
    last_message_at = excluded.last_message_at, last_message_body = excluded.last_message_body,
    last_message_sender_type = 'tenant', tenant_last_read_at = now()
  returning * into v_conversation;
  insert into rental_conversation_messages (owner_id, id, conversation_id, sender_type, body, created_at)
  values (v_tenant.owner_id, 'rental_conversation_message_' || gen_random_uuid()::text, v_conversation.id, 'tenant', btrim(p_body), now())
  returning * into v_message;
  return jsonb_build_object('conversationId', v_conversation.id, 'messageId', v_message.id,
    'createdAt', v_message.created_at, 'tenantId', v_tenant.id, 'workOrderId', p_work_order_id,
    'ownerId', v_tenant.owner_id, 'leaseId', v_request.lease_id, 'tenantName', v_tenant.display_name);
end;
$$;

create or replace function mark_rental_work_order_read_by_owner(p_work_order_id text)
returns void language plpgsql security definer set search_path = public set row_security = off as $$
declare v_owner_id text := resolve_effective_owner_id();
begin
  if not has_workspace_access(v_owner_id) then
    raise exception 'Workspace access is required.' using errcode = '42501';
  end if;
  update rental_conversations set owner_last_read_at = now()
  where owner_id = v_owner_id and work_order_id = p_work_order_id;
end;
$$;

create or replace function mark_rental_work_order_read_by_tenant(p_work_order_id text)
returns void language plpgsql security definer set search_path = public set row_security = off as $$
declare v_tenant rental_tenants%rowtype;
begin
  select * into v_tenant from rental_tenants where auth_user_id = auth.uid();
  if v_tenant.id is null then
    raise exception 'No tenant portal access is linked to this account.' using errcode = '42501';
  end if;
  update rental_conversations set tenant_last_read_at = now()
  where owner_id = v_tenant.owner_id and work_order_id = p_work_order_id and tenant_id = v_tenant.id;
end;
$$;

-- Tenant reads a work order's thread. Verifies the work order belongs to the tenant's own
-- request, marks the thread read, and returns the messages oldest-first.
create or replace function read_rental_work_order_tenant_messages(p_work_order_id text)
returns jsonb language plpgsql security definer set search_path = public set row_security = off as $$
declare
  v_tenant rental_tenants%rowtype;
  v_conversation_id text;
begin
  select * into v_tenant from rental_tenants where auth_user_id = auth.uid();
  if v_tenant.id is null then
    raise exception 'No tenant portal access is linked to this account.' using errcode = '42501';
  end if;
  select c.id into v_conversation_id
  from rental_conversations c
  join rental_maintenance_work_orders w on w.owner_id = c.owner_id and w.id = c.work_order_id
  join rental_maintenance_requests r on r.owner_id = w.owner_id and r.id = w.request_id
  where c.owner_id = v_tenant.owner_id and c.work_order_id = p_work_order_id
    and c.tenant_id = v_tenant.id and r.tenant_id = v_tenant.id;
  if v_conversation_id is null then
    return jsonb_build_object('messages', '[]'::jsonb);
  end if;
  update rental_conversations set tenant_last_read_at = now()
  where owner_id = v_tenant.owner_id and id = v_conversation_id;
  return jsonb_build_object('messages', coalesce((
    select jsonb_agg(jsonb_build_object('id', m.id, 'senderType', m.sender_type, 'body', m.body, 'createdAt', m.created_at)
      order by m.created_at asc)
    from rental_conversation_messages m
    where m.owner_id = v_tenant.owner_id and m.conversation_id = v_conversation_id
  ), '[]'::jsonb));
end;
$$;

-- Resolves the workspace owner's login email for server-side notification use only.
-- Owner email resolver for the tenant->owner ping. Takes NO arguments: it resolves the
-- landlord from the caller's own tenant row, so there is no owner id to harvest and no address
-- ever reaches the client. The portal route uses this to address the new-message ping.
create or replace function get_rental_owner_notification_email()
returns text language plpgsql security definer set search_path = public set row_security = off as $$
declare v_email text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  select u.email into v_email
  from rental_tenants t
  join auth.users u on u.id = t.owner_id::uuid
  where t.auth_user_id = auth.uid();
  if v_email is null then
    raise exception 'No tenant portal access is linked to this account.' using errcode = '42501';
  end if;
  return v_email;
end;
$$;

revoke all on function send_rental_work_order_owner_message(text, text) from public, anon;
revoke all on function send_rental_work_order_tenant_message(text, text) from public, anon;
revoke all on function mark_rental_work_order_read_by_owner(text) from public, anon;
revoke all on function mark_rental_work_order_read_by_tenant(text) from public, anon;
revoke all on function read_rental_work_order_tenant_messages(text) from public, anon;
revoke all on function get_rental_owner_notification_email() from public, anon;

grant execute on function send_rental_work_order_owner_message(text, text) to authenticated;
grant execute on function send_rental_work_order_tenant_message(text, text) to authenticated;
grant execute on function mark_rental_work_order_read_by_owner(text) to authenticated;
grant execute on function mark_rental_work_order_read_by_tenant(text) to authenticated;
grant execute on function read_rental_work_order_tenant_messages(text) to authenticated;
grant execute on function get_rental_owner_notification_email() to authenticated;

-- Notification type for the new-message ping. Re-added with the FULL known set so this
-- migration is safe regardless of whether R2's statement/invoice email types landed first.
alter table rental_notification_outbox drop constraint if exists rental_notification_outbox_notification_type_check;
alter table rental_notification_outbox add constraint rental_notification_outbox_notification_type_check
  check (notification_type in ('payment_succeeded', 'payment_failed', 'maintenance_updated',
    'document_published', 'rent_reminder', 'balance_overdue', 'statement_emailed', 'invoice_emailed',
    'work_order_message'));

-- Tenant portal work-order payload gains hasUnreadMessages.
create or replace function load_rental_maintenance_work_updates(p_lease_id text)returns jsonb language sql stable security definer set search_path=public set row_security=off as $$
select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'requestId',w.request_id,'status',w.status,'scheduledStart',w.scheduled_start,'scheduledEnd',w.scheduled_end,'hasUnreadMessages',coalesce((select c.last_message_sender_type='owner' and (c.tenant_last_read_at is null or c.last_message_at>c.tenant_last_read_at) from rental_conversations c where c.owner_id=w.owner_id and c.work_order_id=w.id),false),'updates',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'eventType',e.event_type,'publicNote',e.public_note,'occurredAt',e.occurred_at)order by e.occurred_at desc)from rental_maintenance_work_events e where e.owner_id=w.owner_id and e.work_order_id=w.id and e.public_note is not null),'[]'::jsonb))order by w.created_at desc),'[]'::jsonb)
from rental_maintenance_work_orders w join rental_maintenance_requests r on r.owner_id=w.owner_id and r.id=w.request_id where r.lease_id=p_lease_id and rental_actor_has_lease_access(r.owner_id,r.lease_id);$$;
