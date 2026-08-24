-- Adds a durable, editable business/personal split to financial_events. Until now every
-- financial_events source has been implicitly business (Rentec, the FORGE rental-payment
-- triggers, and manual rental entries are all rental-portfolio-only by construction). The Simplifi
-- CSV importer is the first source that can legitimately write personal transactions too, and the
-- import decision is: personal transactions ARE imported (for personal net-worth/cash-flow
-- reporting) but must never contribute to rental performance, NOI, business profit, or tax totals.
--
-- business_scope defaults to 'business' so every pre-existing row (and every future row from a
-- source other than the Simplifi importer) keeps its current, already-correct business meaning
-- with no backfill required. It is a plain, owner-updatable column (not derived/computed) so a
-- later relabeling feature can flip a specific row from 'personal' to 'business' with a normal
-- UPDATE — implementing that relabeling UI/workflow is future work, not a prerequisite here.
alter table financial_events
  add column if not exists business_scope text not null default 'business'
    check (business_scope in ('business', 'personal'));

create index if not exists idx_financial_events_owner_business_scope
  on financial_events(owner_id, business_scope);
