-- FORGE Engineering Brain -- Phase 3 persistence layer. Moves the Phase 1/2 index from a local-only
-- JSON manifest into queryable Supabase storage. Purely additive: three new tables, no changes to
-- any existing schema. Programmer-only access (see is_forge_programmer() below), matching the
-- existing Developer Control Center's single-allowlisted-email authorization model
-- (ProgrammerAuthorizationApplication.js) -- this is FORGE's own engineering metadata, not
-- owner/tenant data, so it deliberately does not follow the owner_id-scoped RLS convention used
-- everywhere else in this codebase.
--
-- Append-only by design: each indexer run writes a new engineering_brain_runs row plus its own full
-- set of records/excluded rows, rather than updating a single "current" row in place. This preserves
-- history (Phase 2's "what changed in a specified commit" acceptance question needs more than one
-- commit indexed to ever answer that meaningfully) while staying simple -- no versioning logic
-- beyond "order by generated_at desc" to find the latest run. The unique (commit_sha,
-- index_content_hash) constraint makes re-syncing the same unchanged commit a safe no-op rather than
-- accumulating duplicate rows.

create table if not exists engineering_brain_runs (
    id text primary key,
    commit_sha text not null,
    extractor_version integer not null,
    schema_version text not null,
    index_content_hash text not null,
    generated_at timestamptz not null,
    counts jsonb not null,
    created_at timestamptz not null default now(),
    unique (commit_sha, index_content_hash)
);

create index if not exists idx_engineering_brain_runs_generated_at on engineering_brain_runs(generated_at desc);

create table if not exists engineering_brain_records (
    run_id text not null references engineering_brain_runs(id) on delete cascade,
    id text not null,
    source_path text not null,
    source_type text not null,
    symbol_or_section text,
    commit_sha text not null,
    content_hash text not null,
    authority_level text not null,
    version text,
    details jsonb,
    primary key (run_id, id)
);

create index if not exists idx_engineering_brain_records_source_path on engineering_brain_records(source_path);
create index if not exists idx_engineering_brain_records_source_type on engineering_brain_records(source_type);
create index if not exists idx_engineering_brain_records_authority_level on engineering_brain_records(authority_level);
create index if not exists idx_engineering_brain_records_symbol on engineering_brain_records(symbol_or_section);

create table if not exists engineering_brain_excluded (
    run_id text not null references engineering_brain_runs(id) on delete cascade,
    id text not null,
    source_path text not null,
    reason text not null,
    primary key (run_id, id)
);

alter table engineering_brain_runs enable row level security;
alter table engineering_brain_runs force row level security;
alter table engineering_brain_records enable row level security;
alter table engineering_brain_records force row level security;
alter table engineering_brain_excluded enable row level security;
alter table engineering_brain_excluded force row level security;

-- Mirrors ProgrammerAuthorizationApplication.js's allowlisted-email check exactly, so RLS and the
-- app's own Developer Control Center authorization can never disagree about who this data is for.
-- Known limitation, flagged rather than silently assumed: the JS layer supports an env-var override
-- (FORGE_PROGRAMMER_EMAIL) that this SQL function cannot read; if that env var is ever set to
-- something other than the hardcoded default below, this function needs a matching manual update.
create or replace function public.is_forge_programmer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(auth.jwt() ->> 'email', '') = 'jasonmorgan99@gmail.com';
$$;

revoke all on function public.is_forge_programmer() from public;
grant execute on function public.is_forge_programmer() to authenticated;

create policy "engineering_brain_runs_programmer_all" on engineering_brain_runs
    for all to authenticated using (is_forge_programmer()) with check (is_forge_programmer());
create policy "engineering_brain_records_programmer_all" on engineering_brain_records
    for all to authenticated using (is_forge_programmer()) with check (is_forge_programmer());
create policy "engineering_brain_excluded_programmer_all" on engineering_brain_excluded
    for all to authenticated using (is_forge_programmer()) with check (is_forge_programmer());
