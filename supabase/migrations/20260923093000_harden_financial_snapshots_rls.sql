-- Harden financial_snapshots: the table was created without row-level security
-- and is reachable with the project's publishable key, so anyone could read or
-- write financial snapshot rows. Scope every row to its owning user; anonymous
-- callers (auth.uid() IS NULL) match no rows for any operation.
alter table public.financial_snapshots
  add column if not exists owner_id uuid null;

create index if not exists financial_snapshots_owner_id_idx
  on public.financial_snapshots (owner_id);

alter table public.financial_snapshots enable row level security;

drop policy if exists financial_snapshots_owner_select on public.financial_snapshots;
create policy financial_snapshots_owner_select
  on public.financial_snapshots for select
  using (auth.uid() = owner_id);

drop policy if exists financial_snapshots_owner_insert on public.financial_snapshots;
create policy financial_snapshots_owner_insert
  on public.financial_snapshots for insert
  with check (auth.uid() = owner_id);

drop policy if exists financial_snapshots_owner_update on public.financial_snapshots;
create policy financial_snapshots_owner_update
  on public.financial_snapshots for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists financial_snapshots_owner_delete on public.financial_snapshots;
create policy financial_snapshots_owner_delete
  on public.financial_snapshots for delete
  using (auth.uid() = owner_id);
