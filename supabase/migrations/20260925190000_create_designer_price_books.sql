-- Home Designer supplier cabinet price books (2026-09-25).
--
-- One row per (workspace owner, price book). A book is a supplier's price
-- list the user maintains in the Designer: codes, names, item numbers,
-- prices (integer cents), discontinued flags, and an "as of" date, in the
-- shape produced by src/domains/roomDesigner/cabinetPriceBooks.js
-- (normalizeBook) and stored whole in the `book` jsonb column.
--
-- Why a table: price lists are private business data. They must not live
-- in the public repository, must follow the owner across devices, and must
-- survive cleared browser storage. The API route
-- /api/forge/designer/price-books reads and writes rows under the caller's
-- effective (workspace) owner id, exactly like designer_projects.
--
-- Security model: RLS forced; one policy per verb, all gated on
-- has_workspace_access(owner_id) (the designer_projects model, so a
-- workspace co-owner shares the owner's price lists). Grants are positive
-- and minimal per the 20260912 explicit-grant contract: authenticated gets
-- select/insert/update/delete; anon gets nothing.
--
-- Additive only: no existing table is touched, so this migration is safe to
-- apply before the app change that uses it (the app falls back to
-- browser-local storage when the table is unavailable).

create table if not exists designer_price_books (
  owner_id text not null,
  book_id text not null,
  primary key (owner_id, book_id),

  book jsonb not null check (jsonb_typeof(book) = 'object'),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table designer_price_books enable row level security;
alter table designer_price_books force row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'designer_price_books'
      and policyname = 'designer_price_books_owner_select'
  ) then
    create policy "designer_price_books_owner_select" on designer_price_books
      for select to authenticated
      using (has_workspace_access(owner_id));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'designer_price_books'
      and policyname = 'designer_price_books_owner_insert'
  ) then
    create policy "designer_price_books_owner_insert" on designer_price_books
      for insert to authenticated
      with check (has_workspace_access(owner_id));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'designer_price_books'
      and policyname = 'designer_price_books_owner_update'
  ) then
    create policy "designer_price_books_owner_update" on designer_price_books
      for update to authenticated
      using (has_workspace_access(owner_id))
      with check (has_workspace_access(owner_id));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'designer_price_books'
      and policyname = 'designer_price_books_owner_delete'
  ) then
    create policy "designer_price_books_owner_delete" on designer_price_books
      for delete to authenticated
      using (has_workspace_access(owner_id));
  end if;
end $$;

-- Revoke first: Supabase's default privileges grant ALL (including TRUNCATE,
-- REFERENCES, TRIGGER) on new public tables. The contract wants exactly the
-- four verbs the app uses, for authenticated only.
revoke all on designer_price_books from anon, authenticated;
grant select, insert, update, delete on designer_price_books to authenticated;
