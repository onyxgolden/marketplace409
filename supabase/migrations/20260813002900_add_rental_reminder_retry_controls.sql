alter table rental_notification_outbox drop constraint if exists rental_notification_outbox_notification_type_check;
alter table rental_notification_outbox add constraint rental_notification_outbox_notification_type_check check(notification_type in('payment_succeeded','payment_failed','maintenance_updated','document_published','rent_reminder','balance_overdue'));
alter table rental_notification_outbox add column if not exists scheduled_for timestamptz not null default now();
alter table rental_notification_outbox add column if not exists attempt_count smallint not null default 0 check(attempt_count between 0 and 10);
alter table rental_notification_outbox add column if not exists max_attempts smallint not null default 3 check(max_attempts between 1 and 5);
alter table rental_notification_outbox add column if not exists last_attempt_at timestamptz;
alter table rental_notification_outbox add column if not exists next_attempt_at timestamptz;
alter table rental_notification_outbox add column if not exists cancelled_at timestamptz;

create or replace function queue_rental_balance_reminder(p_owner_id text,p_charge_id text,p_scheduled_for timestamptz,p_notification_type text,p_max_attempts smallint)
returns rental_notification_outbox language plpgsql security invoker set search_path=public as $$
declare c rent_charges;t rental_tenants;result rental_notification_outbox;v_key text;
begin
 if p_owner_id<>auth.uid()::text then raise exception 'Owner identity mismatch.';end if;
 if p_notification_type not in('rent_reminder','balance_overdue') or p_max_attempts not between 1 and 5 then raise exception 'Reminder controls are invalid.';end if;
 select * into c from rent_charges where owner_id=p_owner_id and id=p_charge_id and status in('scheduled','due','partially_paid','overdue');
 if c.id is null then raise exception 'Open charge was not found.';end if;
 select tenant.* into t from rental_lease_tenants m join rental_tenants tenant on tenant.owner_id=m.owner_id and tenant.id=m.tenant_id where m.owner_id=p_owner_id and m.lease_id=c.lease_id order by tenant.created_at limit 1;
 if t.id is null then raise exception 'Tenant recipient was not found.';end if;
 v_key:='charge:'||c.id||':'||p_notification_type||':'||extract(epoch from date_trunc('minute',p_scheduled_for))::text;
 insert into rental_notification_outbox(owner_id,id,tenant_id,lease_id,event_key,notification_type,recipient,subject,body_text,scheduled_for,max_attempts)
 values(p_owner_id,'rental_notification_'||gen_random_uuid()::text,t.id,c.lease_id,v_key,p_notification_type,t.email,case when p_notification_type='balance_overdue' then 'FORGE rental balance is overdue' else 'FORGE upcoming rent reminder' end,'Your current rental balance is $'||to_char((c.amount_cents-c.paid_amount_cents)/100.0,'FM999999990.00')||' and is due '||c.due_date||'. Review your tenant portal for payment details.',p_scheduled_for,p_max_attempts) returning * into result;
 return result;
end $$;
grant execute on function queue_rental_balance_reminder(text,text,timestamptz,text,smallint) to authenticated;

create or replace function cancel_rental_notification(p_owner_id text,p_notification_id text)
returns rental_notification_outbox language plpgsql security invoker set search_path=public as $$declare result rental_notification_outbox;begin
 update rental_notification_outbox set status='cancelled',cancelled_at=now() where owner_id=p_owner_id and p_owner_id=auth.uid()::text and id=p_notification_id and status in('queued','failed') returning * into result;
 if result.id is null then raise exception 'Cancellable notification was not found.';end if;return result;end$$;
grant execute on function cancel_rental_notification(text,text) to authenticated;
