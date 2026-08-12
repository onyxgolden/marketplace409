insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('rental-documents', 'rental-documents', false, 10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'text/plain'])
on conflict (id) do update set public=excluded.public, file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

create table if not exists rental_documents (
  owner_id text not null,
  id text not null,
  lease_id text not null,
  category text not null check(category in ('lease','addendum','notice','inspection','receipt','other')),
  title text not null check(btrim(title)<>''),
  bucket text not null default 'rental-documents' check(bucket='rental-documents'),
  object_path text not null,
  original_filename text not null check(btrim(original_filename)<>''),
  mime_type text not null check(mime_type in ('application/pdf','image/jpeg','image/png','text/plain')),
  byte_size bigint not null check(byte_size>0 and byte_size<=10485760),
  tenant_visible boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(owner_id,id),
  unique(bucket,object_path),
  foreign key(owner_id,lease_id) references rental_leases(owner_id,id) on delete cascade,
  check(split_part(object_path,'/',1)=owner_id)
);

create index if not exists idx_rental_documents_owner_lease on rental_documents(owner_id,lease_id,created_at desc);
alter table rental_documents enable row level security;
alter table rental_documents force row level security;
create policy "rental_documents_owner_all" on rental_documents for all to authenticated
  using(owner_id=auth.uid()::text) with check(owner_id=auth.uid()::text);
create policy "rental_documents_tenant_select" on rental_documents for select to authenticated
  using(tenant_visible and rental_actor_has_lease_access(owner_id,lease_id));

create policy "rental_document_objects_owner_select" on storage.objects for select to authenticated
  using(bucket_id='rental-documents' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "rental_document_objects_owner_insert" on storage.objects for insert to authenticated
  with check(bucket_id='rental-documents' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "rental_document_objects_tenant_select" on storage.objects for select to authenticated
  using(bucket_id='rental-documents' and exists(
    select 1 from rental_documents document
    where document.bucket=storage.objects.bucket_id and document.object_path=storage.objects.name
      and document.tenant_visible and rental_actor_has_lease_access(document.owner_id,document.lease_id)
  ));
