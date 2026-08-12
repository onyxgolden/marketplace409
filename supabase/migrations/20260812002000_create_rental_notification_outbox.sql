create table if not exists rental_notification_outbox (
  owner_id text not null,
  id text not null,
  tenant_id text not null,
  lease_id text not null,
  event_key text not null,
  notification_type text not null check(notification_type in ('payment_succeeded','payment_failed','maintenance_updated','document_published')),
  channel text not null default 'email' check(channel in ('email')),
  recipient text not null check(btrim(recipient)<>''),
  subject text not null check(btrim(subject)<>''),
  body_text text not null check(btrim(body_text)<>''),
  status text not null default 'queued' check(status in ('queued','sending','sent','failed','cancelled')),
  provider_message_id text,
  failure_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  primary key(owner_id,id),
  unique(event_key),
  foreign key(owner_id,tenant_id) references rental_tenants(owner_id,id) on delete cascade,
  foreign key(owner_id,lease_id) references rental_leases(owner_id,id) on delete cascade
);
create index if not exists idx_rental_notification_owner_status on rental_notification_outbox(owner_id,status,created_at);
alter table rental_notification_outbox enable row level security;
alter table rental_notification_outbox force row level security;
create policy "rental_notification_owner_select" on rental_notification_outbox for select to authenticated using(owner_id=auth.uid()::text);

create or replace function queue_rental_notification() returns trigger language plpgsql security definer set search_path=public set row_security=off as $$
declare v_tenant rental_tenants%rowtype; v_type text; v_subject text; v_body text; v_key text; v_lease_id text;
begin
  if tg_table_name='rental_payments' then
    if new.status not in ('succeeded','failed') or new.status is not distinct from old.status then return new; end if;
    v_lease_id:=new.lease_id; v_type:=case when new.status='succeeded' then 'payment_succeeded' else 'payment_failed' end;
    v_subject:=case when new.status='succeeded' then 'FORGE rent payment receipt' else 'FORGE rent payment needs attention' end;
    v_body:=case when new.status='succeeded' then 'Your rent payment of $'||to_char(new.amount_cents/100.0,'FM999999990.00')||' was received successfully.'
      else 'Your rent payment could not be completed. Please return to the tenant portal to review your balance and try again.' end;
    v_key:='payment:'||new.id||':'||new.status;
  elsif tg_table_name='rental_maintenance_requests' then
    if new.status is not distinct from old.status and new.owner_notes is not distinct from old.owner_notes then return new; end if;
    v_lease_id:=new.lease_id;v_type:='maintenance_updated';v_subject:='Maintenance request updated: '||new.title;
    v_body:='Your maintenance request is now '||replace(new.status,'_',' ')||'.'||case when new.owner_notes is null then '' else ' Landlord update: '||new.owner_notes end;
    v_key:='maintenance:'||new.id||':'||extract(epoch from new.updated_at)::text;
  elsif tg_table_name='rental_documents' then
    if not new.tenant_visible then return new; end if;
    if tg_op='UPDATE' and old.tenant_visible then return new; end if;
    v_lease_id:=new.lease_id;v_type:='document_published';v_subject:='New rental document: '||new.title;
    v_body:='A new '||new.category||' document is available in your FORGE tenant portal.';v_key:='document:'||new.id||':published';
  else return new; end if;
  select tenant.* into v_tenant from rental_lease_tenants membership join rental_tenants tenant on tenant.owner_id=membership.owner_id and tenant.id=membership.tenant_id
    where membership.owner_id=new.owner_id and membership.lease_id=v_lease_id order by tenant.created_at limit 1;
  if v_tenant.id is null then return new; end if;
  insert into rental_notification_outbox(owner_id,id,tenant_id,lease_id,event_key,notification_type,recipient,subject,body_text)
    values(new.owner_id,'rental_notification_'||gen_random_uuid()::text,v_tenant.id,v_lease_id,v_key,v_type,v_tenant.email,v_subject,v_body)
    on conflict(event_key) do nothing;
  return new;
end;$$;

drop trigger if exists queue_rental_payment_notification on rental_payments;
create trigger queue_rental_payment_notification after update of status on rental_payments for each row execute function queue_rental_notification();
drop trigger if exists queue_rental_maintenance_notification on rental_maintenance_requests;
create trigger queue_rental_maintenance_notification after update of status,owner_notes on rental_maintenance_requests for each row execute function queue_rental_notification();
drop trigger if exists queue_rental_document_insert_notification on rental_documents;
create trigger queue_rental_document_insert_notification after insert on rental_documents for each row execute function queue_rental_notification();
drop trigger if exists queue_rental_document_update_notification on rental_documents;
create trigger queue_rental_document_update_notification after update of tenant_visible on rental_documents for each row execute function queue_rental_notification();

revoke all on function queue_rental_notification() from public,anon,authenticated;
