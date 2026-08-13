create table if not exists rental_email_settings (
  owner_id text primary key,
  provider text not null default 'http' check(provider in ('http')),
  sender_name text not null check(btrim(sender_name)<>''),
  sender_email text not null check(sender_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  verified_domain text,
  status text not null default 'draft' check(status in ('draft','verified','active','paused')),
  transactional_enabled boolean not null default true,
  reminders_enabled boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table rental_email_settings enable row level security;alter table rental_email_settings force row level security;
create policy "rental_email_settings_owner" on rental_email_settings for all to authenticated using(owner_id=auth.uid()::text) with check(owner_id=auth.uid()::text);

create table if not exists rental_notification_preferences (
  owner_id text not null, tenant_id text not null, optional_reminders_enabled boolean not null default true,
  updated_at timestamptz not null default now(), primary key(owner_id,tenant_id),
  foreign key(owner_id,tenant_id) references rental_tenants(owner_id,id) on delete cascade
);
alter table rental_notification_preferences enable row level security;alter table rental_notification_preferences force row level security;
create policy "rental_notification_preferences_owner_select" on rental_notification_preferences for select to authenticated using(owner_id=auth.uid()::text);

create table if not exists rental_notification_delivery_events (
  owner_id text not null, id text not null, notification_id text not null, provider_event_id text,
  event_type text not null check(event_type in ('accepted','delivered','deferred','bounced','complained','failed')),
  event_at timestamptz not null default now(), detail text, created_at timestamptz not null default now(),
  primary key(owner_id,id), unique(provider_event_id),
  foreign key(owner_id,notification_id) references rental_notification_outbox(owner_id,id) on delete cascade
);
create index if not exists idx_rental_delivery_notification on rental_notification_delivery_events(owner_id,notification_id,event_at);
alter table rental_notification_delivery_events enable row level security;alter table rental_notification_delivery_events force row level security;
create policy "rental_delivery_owner_select" on rental_notification_delivery_events for select to authenticated using(owner_id=auth.uid()::text);

create or replace function set_rental_optional_reminders(p_enabled boolean) returns rental_notification_preferences language plpgsql security definer set search_path=public set row_security=off as $$
declare v_tenant rental_tenants; result rental_notification_preferences;
begin
 select * into v_tenant from rental_tenants where auth_user_id=auth.uid()::text order by created_at limit 1;
 if v_tenant.id is null then raise exception 'Tenant portal access was not found.';end if;
 insert into rental_notification_preferences(owner_id,tenant_id,optional_reminders_enabled,updated_at) values(v_tenant.owner_id,v_tenant.id,p_enabled,now())
 on conflict(owner_id,tenant_id) do update set optional_reminders_enabled=excluded.optional_reminders_enabled,updated_at=now() returning * into result;return result;
end$$;
grant execute on function set_rental_optional_reminders(boolean) to authenticated;

create or replace function claim_rental_email_notification() returns rental_notification_outbox language plpgsql security definer set search_path=public set row_security=off as $$
declare result rental_notification_outbox;
begin
 select n.* into result from rental_notification_outbox n join rental_email_settings s on s.owner_id=n.owner_id and s.status='active'
 left join rental_notification_preferences p on p.owner_id=n.owner_id and p.tenant_id=n.tenant_id
 where n.status in('queued','failed') and n.cancelled_at is null and coalesce(n.next_attempt_at,n.scheduled_for)<=now() and n.attempt_count<n.max_attempts
 and (case when n.notification_type in('rent_reminder','balance_overdue') then s.reminders_enabled and coalesce(p.optional_reminders_enabled,true) else s.transactional_enabled end)
 order by coalesce(n.next_attempt_at,n.scheduled_for),n.created_at for update of n skip locked limit 1;
 if result.id is not null then update rental_notification_outbox set status='sending',attempt_count=attempt_count+1,last_attempt_at=now(),failure_message=null where owner_id=result.owner_id and id=result.id returning * into result;end if;
 return result;
end$$;
revoke all on function claim_rental_email_notification() from public,anon,authenticated;

create or replace function complete_rental_email_delivery(p_owner_id text,p_notification_id text,p_succeeded boolean,p_provider_message_id text,p_failure_message text) returns void language plpgsql security definer set search_path=public set row_security=off as $$
begin
 update rental_notification_outbox set status=case when p_succeeded then 'sent' when attempt_count>=max_attempts then 'failed' else 'queued' end,
 provider_message_id=coalesce(p_provider_message_id,provider_message_id),failure_message=case when p_succeeded then null else left(coalesce(p_failure_message,'Provider delivery failed.'),500) end,
 sent_at=case when p_succeeded then now() else sent_at end,next_attempt_at=case when p_succeeded or attempt_count>=max_attempts then null else now()+make_interval(mins=>least(60,5*(2^greatest(attempt_count-1,0))::int)) end
 where owner_id=p_owner_id and id=p_notification_id and status='sending';
end$$;
revoke all on function complete_rental_email_delivery(text,text,boolean,text,text) from public,anon,authenticated;
