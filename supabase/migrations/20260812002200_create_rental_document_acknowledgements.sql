create table if not exists rental_document_acknowledgements (
  owner_id text not null,
  document_id text not null,
  lease_id text not null,
  tenant_id text not null,
  acknowledged_at timestamptz not null default now(),
  acknowledgement_version text not null default 'receipt-v1',
  primary key(owner_id,document_id,tenant_id),
  foreign key(owner_id,document_id) references rental_documents(owner_id,id) on delete cascade,
  foreign key(owner_id,lease_id) references rental_leases(owner_id,id) on delete cascade,
  foreign key(owner_id,tenant_id) references rental_tenants(owner_id,id) on delete cascade
);
create index if not exists idx_rental_document_ack_owner_lease on rental_document_acknowledgements(owner_id,lease_id,acknowledged_at desc);
alter table rental_document_acknowledgements enable row level security;
alter table rental_document_acknowledgements force row level security;
create policy "rental_document_ack_owner_select" on rental_document_acknowledgements for select to authenticated using(owner_id=auth.uid()::text);
create policy "rental_document_ack_tenant_select" on rental_document_acknowledgements for select to authenticated
  using(rental_actor_has_lease_access(owner_id,lease_id));

create or replace function acknowledge_rental_document(p_document_id text)
returns jsonb language plpgsql security definer set search_path=public set row_security=off as $$
declare v_document rental_documents%rowtype;v_tenant_id text;v_acknowledged_at timestamptz;
begin
  if auth.uid() is null then raise exception 'Authentication is required.';end if;
  select * into v_document from rental_documents where id=p_document_id and tenant_visible=true
    and rental_actor_has_lease_access(owner_id,lease_id) limit 1;
  if v_document.id is null then raise exception 'The document is not available to the authenticated tenant.';end if;
  select membership.tenant_id into v_tenant_id from rental_lease_tenants membership
    join rental_tenants tenant on tenant.owner_id=membership.owner_id and tenant.id=membership.tenant_id
    where membership.owner_id=v_document.owner_id and membership.lease_id=v_document.lease_id and tenant.auth_user_id=auth.uid() limit 1;
  if v_tenant_id is null then raise exception 'Tenant identity could not be resolved.';end if;
  insert into rental_document_acknowledgements(owner_id,document_id,lease_id,tenant_id)
    values(v_document.owner_id,v_document.id,v_document.lease_id,v_tenant_id)
    on conflict(owner_id,document_id,tenant_id) do update set acknowledgement_version=excluded.acknowledgement_version
    returning acknowledged_at into v_acknowledged_at;
  return jsonb_build_object('document_id',v_document.id,'tenant_id',v_tenant_id,'acknowledged_at',v_acknowledged_at,
    'acknowledgement_version','receipt-v1');
end;$$;
revoke all on function acknowledge_rental_document(text) from public,anon;
grant execute on function acknowledge_rental_document(text) to authenticated;
