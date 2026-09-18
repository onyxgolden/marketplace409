-- FORGE has no way for a tenant or private-financing borrower to reach their owner from inside
-- the app -- only one-way, template-only notifications (rental_notification_outbox, 6 fixed
-- types, email channel only) and a payment-incident case table (rental_support_cases) that's
-- RLS-readable by the tenant but never rendered in the tenant portal and has no tenant-side reply
-- path. This adds a real, free-text, two-way channel: one continuous conversation per
-- tenant<->owner relationship (rental) and one per borrower<->owner relationship (private
-- financing), mirroring each other and the codebase's existing per-domain isolation (same shape
-- as the rental vs private-financing payment tables added earlier). Zero new vendor dependency --
-- in-app only, no email/SMS delivery in this slice.
--
-- A tenant/borrower may optionally tag their own message as 'issue' or 'suggestion' so an owner's
-- inbox can tell "something's broken" apart from "you should add X" without forcing a rigid
-- ticket-style split -- most messages need neither tag. Owner messages are never categorized.

create table if not exists rental_conversations (
  owner_id text not null,
  id text not null,
  tenant_id text not null,
  last_message_at timestamptz not null default now(),
  last_message_body text,
  last_message_sender_type text check (last_message_sender_type in ('owner', 'tenant')),
  owner_last_read_at timestamptz,
  tenant_last_read_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (owner_id, id),
  unique (owner_id, tenant_id),
  foreign key (owner_id, tenant_id) references rental_tenants (owner_id, id) on delete restrict
);

create table if not exists rental_conversation_messages (
  owner_id text not null,
  id text not null,
  conversation_id text not null,
  sender_type text not null check (sender_type in ('owner', 'tenant')),
  body text not null check (btrim(body) <> ''),
  category text check (category is null or category in ('issue', 'suggestion')),
  created_at timestamptz not null default now(),
  primary key (owner_id, id),
  foreign key (owner_id, conversation_id) references rental_conversations (owner_id, id) on delete restrict
);
create index if not exists idx_rental_conversation_messages_conversation
  on rental_conversation_messages (owner_id, conversation_id, created_at);

create table if not exists private_financing_conversations (
  owner_id text not null,
  id text not null,
  borrower_id text not null,
  last_message_at timestamptz not null default now(),
  last_message_body text,
  last_message_sender_type text check (last_message_sender_type in ('owner', 'borrower')),
  owner_last_read_at timestamptz,
  borrower_last_read_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (owner_id, id),
  unique (owner_id, borrower_id),
  foreign key (owner_id, borrower_id) references private_financing_borrowers (owner_id, id) on delete restrict
);

create table if not exists private_financing_conversation_messages (
  owner_id text not null,
  id text not null,
  conversation_id text not null,
  sender_type text not null check (sender_type in ('owner', 'borrower')),
  body text not null check (btrim(body) <> ''),
  category text check (category is null or category in ('issue', 'suggestion')),
  created_at timestamptz not null default now(),
  primary key (owner_id, id),
  foreign key (owner_id, conversation_id) references private_financing_conversations (owner_id, id) on delete restrict
);
create index if not exists idx_private_financing_conversation_messages_conversation
  on private_financing_conversation_messages (owner_id, conversation_id, created_at);

alter table rental_conversations enable row level security;
alter table rental_conversations force row level security;
alter table rental_conversation_messages enable row level security;
alter table rental_conversation_messages force row level security;
alter table private_financing_conversations enable row level security;
alter table private_financing_conversations force row level security;
alter table private_financing_conversation_messages enable row level security;
alter table private_financing_conversation_messages force row level security;

-- Read-only for everyone at the RLS layer -- every write happens through the security-definer
-- RPCs below, which derive owner/tenant/borrower identity themselves and never trust a
-- client-supplied id for any of them. No insert/update/delete policy is granted to any role.
create policy "rental_conversations_owner_select" on rental_conversations
  for select to authenticated using (has_workspace_access(owner_id));
create policy "rental_conversations_tenant_select" on rental_conversations
  for select to authenticated using (exists (
    select 1 from rental_tenants t
    where t.owner_id = rental_conversations.owner_id and t.id = rental_conversations.tenant_id and t.auth_user_id = auth.uid()
  ));
create policy "rental_conversation_messages_owner_select" on rental_conversation_messages
  for select to authenticated using (has_workspace_access(owner_id));
create policy "rental_conversation_messages_tenant_select" on rental_conversation_messages
  for select to authenticated using (exists (
    select 1 from rental_conversations c join rental_tenants t on t.owner_id = c.owner_id and t.id = c.tenant_id
    where c.owner_id = rental_conversation_messages.owner_id and c.id = rental_conversation_messages.conversation_id and t.auth_user_id = auth.uid()
  ));

create policy "pf_conversations_owner_select" on private_financing_conversations
  for select to authenticated using (has_workspace_access(owner_id));
create policy "pf_conversations_borrower_select" on private_financing_conversations
  for select to authenticated using (exists (
    select 1 from private_financing_borrowers b
    where b.owner_id = private_financing_conversations.owner_id and b.id = private_financing_conversations.borrower_id and b.auth_user_id = auth.uid()
  ));
create policy "pf_conversation_messages_owner_select" on private_financing_conversation_messages
  for select to authenticated using (has_workspace_access(owner_id));
create policy "pf_conversation_messages_borrower_select" on private_financing_conversation_messages
  for select to authenticated using (exists (
    select 1 from private_financing_conversations c join private_financing_borrowers b on b.owner_id = c.owner_id and b.id = c.borrower_id
    where c.owner_id = private_financing_conversation_messages.owner_id and c.id = private_financing_conversation_messages.conversation_id and b.auth_user_id = auth.uid()
  ));

-- RLS restricts which rows a role sees; it does not substitute for the underlying table grant
-- Postgres itself requires before a role may attempt the select at all.
grant select on rental_conversations to authenticated;
grant select on rental_conversation_messages to authenticated;
grant select on private_financing_conversations to authenticated;
grant select on private_financing_conversation_messages to authenticated;

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
  on conflict (owner_id, tenant_id) do update set
    last_message_at = excluded.last_message_at, last_message_body = excluded.last_message_body,
    last_message_sender_type = 'tenant', tenant_last_read_at = now()
  returning * into v_conversation;
  insert into rental_conversation_messages (owner_id, id, conversation_id, sender_type, body, category, created_at)
  values (v_tenant.owner_id, 'rental_conversation_message_' || gen_random_uuid()::text, v_conversation.id, 'tenant', btrim(p_body), p_category, now())
  returning * into v_message;
  return jsonb_build_object('conversationId', v_conversation.id, 'messageId', v_message.id, 'createdAt', v_message.created_at);
end;
$$;

create or replace function mark_rental_conversation_read_by_owner(p_tenant_id text)
returns void language plpgsql security definer set search_path = public set row_security = off as $$
declare v_owner_id text := resolve_effective_owner_id();
begin
  if not has_workspace_access(v_owner_id) then
    raise exception 'Workspace access is required.' using errcode = '42501';
  end if;
  update rental_conversations set owner_last_read_at = now() where owner_id = v_owner_id and tenant_id = p_tenant_id;
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
  update rental_conversations set tenant_last_read_at = now() where owner_id = v_tenant.owner_id and tenant_id = v_tenant.id;
end;
$$;

create or replace function send_pf_conversation_owner_message(p_borrower_id text, p_body text)
returns jsonb language plpgsql security definer set search_path = public set row_security = off as $$
declare
  v_owner_id text := resolve_effective_owner_id();
  v_conversation private_financing_conversations%rowtype;
  v_message private_financing_conversation_messages%rowtype;
begin
  if not has_workspace_access(v_owner_id) then
    raise exception 'Workspace access is required.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_body, ''))) = 0 then
    raise exception 'A message body is required.' using errcode = '22023';
  end if;
  if not exists (select 1 from private_financing_borrowers where owner_id = v_owner_id and id = p_borrower_id) then
    raise exception 'Borrower was not found.' using errcode = 'P0002';
  end if;
  insert into private_financing_conversations (owner_id, id, borrower_id, last_message_at, last_message_body, last_message_sender_type, owner_last_read_at)
  values (v_owner_id, 'pf_conversation_' || gen_random_uuid()::text, p_borrower_id, now(), btrim(p_body), 'owner', now())
  on conflict (owner_id, borrower_id) do update set
    last_message_at = excluded.last_message_at, last_message_body = excluded.last_message_body,
    last_message_sender_type = 'owner', owner_last_read_at = now()
  returning * into v_conversation;
  insert into private_financing_conversation_messages (owner_id, id, conversation_id, sender_type, body, created_at)
  values (v_owner_id, 'pf_conversation_message_' || gen_random_uuid()::text, v_conversation.id, 'owner', btrim(p_body), now())
  returning * into v_message;
  return jsonb_build_object('conversationId', v_conversation.id, 'messageId', v_message.id, 'createdAt', v_message.created_at);
end;
$$;

-- p_owner_id is optional and only needed to disambiguate a borrower who has separate identities
-- under more than one owner (unlike rental_tenants, private_financing_borrowers.auth_user_id has
-- no uniqueness constraint) -- omitted, it resolves cleanly whenever exactly one identity exists,
-- which is the overwhelmingly common case.
create or replace function send_pf_conversation_borrower_message(p_body text, p_category text default null, p_owner_id text default null)
returns jsonb language plpgsql security definer set search_path = public set row_security = off as $$
declare
  v_borrower private_financing_borrowers%rowtype;
  v_match_count integer;
  v_conversation private_financing_conversations%rowtype;
  v_message private_financing_conversation_messages%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if p_owner_id is not null then
    select * into v_borrower from private_financing_borrowers where auth_user_id = auth.uid() and owner_id = p_owner_id;
  else
    select count(*) into v_match_count from private_financing_borrowers where auth_user_id = auth.uid();
    if v_match_count > 1 then
      raise exception 'Multiple borrower relationships exist; an owner id is required.' using errcode = '21000';
    end if;
    select * into v_borrower from private_financing_borrowers where auth_user_id = auth.uid();
  end if;
  if v_borrower.id is null then
    raise exception 'No borrower access is linked to this account.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_body, ''))) = 0 then
    raise exception 'A message body is required.' using errcode = '22023';
  end if;
  if p_category is not null and p_category not in ('issue', 'suggestion') then
    raise exception 'Invalid message category.' using errcode = '22023';
  end if;
  insert into private_financing_conversations (owner_id, id, borrower_id, last_message_at, last_message_body, last_message_sender_type, borrower_last_read_at)
  values (v_borrower.owner_id, 'pf_conversation_' || gen_random_uuid()::text, v_borrower.id, now(), btrim(p_body), 'borrower', now())
  on conflict (owner_id, borrower_id) do update set
    last_message_at = excluded.last_message_at, last_message_body = excluded.last_message_body,
    last_message_sender_type = 'borrower', borrower_last_read_at = now()
  returning * into v_conversation;
  insert into private_financing_conversation_messages (owner_id, id, conversation_id, sender_type, body, category, created_at)
  values (v_borrower.owner_id, 'pf_conversation_message_' || gen_random_uuid()::text, v_conversation.id, 'borrower', btrim(p_body), p_category, now())
  returning * into v_message;
  return jsonb_build_object('conversationId', v_conversation.id, 'messageId', v_message.id, 'createdAt', v_message.created_at);
end;
$$;

create or replace function mark_pf_conversation_read_by_owner(p_borrower_id text)
returns void language plpgsql security definer set search_path = public set row_security = off as $$
declare v_owner_id text := resolve_effective_owner_id();
begin
  if not has_workspace_access(v_owner_id) then
    raise exception 'Workspace access is required.' using errcode = '42501';
  end if;
  update private_financing_conversations set owner_last_read_at = now() where owner_id = v_owner_id and borrower_id = p_borrower_id;
end;
$$;

create or replace function mark_pf_conversation_read_by_borrower(p_owner_id text default null)
returns void language plpgsql security definer set search_path = public set row_security = off as $$
declare
  v_borrower private_financing_borrowers%rowtype;
  v_match_count integer;
begin
  if p_owner_id is not null then
    select * into v_borrower from private_financing_borrowers where auth_user_id = auth.uid() and owner_id = p_owner_id;
  else
    select count(*) into v_match_count from private_financing_borrowers where auth_user_id = auth.uid();
    if v_match_count > 1 then
      raise exception 'Multiple borrower relationships exist; an owner id is required.' using errcode = '21000';
    end if;
    select * into v_borrower from private_financing_borrowers where auth_user_id = auth.uid();
  end if;
  if v_borrower.id is null then
    raise exception 'No borrower access is linked to this account.' using errcode = '42501';
  end if;
  update private_financing_conversations set borrower_last_read_at = now() where owner_id = v_borrower.owner_id and borrower_id = v_borrower.id;
end;
$$;

revoke all on function send_rental_conversation_owner_message(text, text) from public, anon;
revoke all on function send_rental_conversation_tenant_message(text, text) from public, anon;
revoke all on function mark_rental_conversation_read_by_owner(text) from public, anon;
revoke all on function mark_rental_conversation_read_by_tenant() from public, anon;
revoke all on function send_pf_conversation_owner_message(text, text) from public, anon;
revoke all on function send_pf_conversation_borrower_message(text, text, text) from public, anon;
revoke all on function mark_pf_conversation_read_by_owner(text) from public, anon;
revoke all on function mark_pf_conversation_read_by_borrower(text) from public, anon;

grant execute on function send_rental_conversation_owner_message(text, text) to authenticated;
grant execute on function send_rental_conversation_tenant_message(text, text) to authenticated;
grant execute on function mark_rental_conversation_read_by_owner(text) to authenticated;
grant execute on function mark_rental_conversation_read_by_tenant() to authenticated;
grant execute on function send_pf_conversation_owner_message(text, text) to authenticated;
grant execute on function send_pf_conversation_borrower_message(text, text, text) to authenticated;
grant execute on function mark_pf_conversation_read_by_owner(text) to authenticated;
grant execute on function mark_pf_conversation_read_by_borrower(text) to authenticated;
