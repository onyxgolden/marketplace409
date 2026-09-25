-- Call Shield Slice B — persistent contact labels.
--
-- Jason marks numbers as personal (filter/dismiss them out of the import
-- view) or as offenders (a symbol is saved on the number so repeat
-- telemarketer calls are recognizable at a glance). Labels are per-owner,
-- keyed on the normalized phone number so they apply across imports.
--
-- New table only; no data changes.

create table if not exists call_contact_labels (
    id uuid primary key,
    owner_id text not null,
    phone_number text not null,
    normalized_phone text not null,
    label text not null check (label in ('personal', 'offender')),
    symbol text not null default '⚠',
    note text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (owner_id, normalized_phone)
);

create index if not exists idx_call_contact_labels_owner_label
    on call_contact_labels(owner_id, label);

alter table call_contact_labels enable row level security;
alter table call_contact_labels force row level security;

-- Policies are created idempotently: reapplying this migration must not fail
-- on already-existing policy names. The policy expressions themselves are
-- unchanged — owner-only access, forced RLS.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'call_contact_labels'
      and policyname = 'call_contact_labels_owner_select'
  ) then
    create policy "call_contact_labels_owner_select" on call_contact_labels
        for select to authenticated
        using (owner_id = auth.uid()::text);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'call_contact_labels'
      and policyname = 'call_contact_labels_owner_insert'
  ) then
    create policy "call_contact_labels_owner_insert" on call_contact_labels
        for insert to authenticated
        with check (owner_id = auth.uid()::text);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'call_contact_labels'
      and policyname = 'call_contact_labels_owner_update'
  ) then
    create policy "call_contact_labels_owner_update" on call_contact_labels
        for update to authenticated
        using (owner_id = auth.uid()::text)
        with check (owner_id = auth.uid()::text);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'call_contact_labels'
      and policyname = 'call_contact_labels_owner_delete'
  ) then
    create policy "call_contact_labels_owner_delete" on call_contact_labels
        for delete to authenticated
        using (owner_id = auth.uid()::text);
  end if;
end $$;

grant select, insert, update, delete on call_contact_labels to authenticated;
