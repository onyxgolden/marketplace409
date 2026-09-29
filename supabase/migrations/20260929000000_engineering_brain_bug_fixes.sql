-- FORGE Engineering Brain -- bug/fix catalog persistence. Purely additive: one new table
-- holding the per-run bug catalog that scripts/engineering-brain/buildBugCatalog.mjs mines from
-- git history (SHA, date, subject, PR, classification, files touched). Each indexer run writes its
-- own full set of bug-fix rows, matching the existing append-only convention -- the catalog is a
-- function of history up to the run's commit, so tying rows to the run keeps "what did the Brain
-- know at commit X" answerable.
--
-- Programmer-only access, same as the other engineering_brain_* tables: this is FORGE's own
-- engineering metadata, not owner/tenant data, so it deliberately does not follow the
-- owner_id-scoped RLS convention used everywhere else in this codebase.

create table if not exists engineering_brain_bug_fixes (
    run_id text not null references engineering_brain_runs(id) on delete cascade,
    id text not null,
    sha text not null,
    date timestamptz,
    subject text not null,
    pr integer,
    class text not null,
    files text[] not null default '{}',
    primary key (run_id, id)
);

create index if not exists idx_engineering_brain_bug_fixes_class on engineering_brain_bug_fixes(class);
create index if not exists idx_engineering_brain_bug_fixes_date on engineering_brain_bug_fixes(date desc);

alter table engineering_brain_bug_fixes enable row level security;
alter table engineering_brain_bug_fixes force row level security;

create policy "engineering_brain_bug_fixes_programmer_all" on engineering_brain_bug_fixes
    for all to authenticated using (is_forge_programmer()) with check (is_forge_programmer());
