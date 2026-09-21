-- HOUSE PLANS (HP-L1) reference metadata model: regulatory sources.
--
-- Link-only regulatory reference layer. This table stores FACTUAL METADATA
-- ONLY about regulatory sources: titles, section identifiers, issuing
-- authority/jurisdiction, edition/effective dates, official URLs, topic tags,
-- provenance, retrieval date, verification date. It deliberately has no
-- summary, content, explanation, or paraphrase columns: FORGE never authors
-- or reproduces explanatory text about regulatory requirements.
--
-- jurisdiction_state is a plain status vocabulary from the House Plans spec:
-- UNRESOLVED / LIKELY / CONFIRMED_BY_USER / VERIFIED_SOURCE. It records how
-- the jurisdiction attribution was established; it carries no compliance
-- logic and no verdict.
--
-- No seed rows: the table ships empty. Curated official links arrive in
-- later slices (HP-L6 Texas links, HP-L8 TDI links) only after verification.

create table if not exists house_plans_regulatory_sources (
  owner_id text not null,
  id uuid not null default gen_random_uuid(),
  primary key (owner_id, id),

  title text not null,
  section_identifier text,
  issuing_authority text not null,
  jurisdiction text,
  edition text,
  effective_date date,
  official_url text not null check (official_url like 'https://%'),
  topic_tags text[] not null default '{}',
  provenance text,
  retrieval_date date,
  verification_date date,
  jurisdiction_state text not null default 'UNRESOLVED'
    check (jurisdiction_state in ('UNRESOLVED', 'LIKELY', 'CONFIRMED_BY_USER', 'VERIFIED_SOURCE')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_house_plans_regulatory_sources_owner
  on house_plans_regulatory_sources(owner_id);

alter table house_plans_regulatory_sources enable row level security;

alter table house_plans_regulatory_sources force row level security;

-- Shared FORGE workspace membership: the acting user resolves to their
-- effective owner (resolveEffectiveOwnerId, the JS twin of
-- resolve_effective_owner_id()) and reads/writes rows under that canonical
-- owner_id; active co-owners get the same access as the primary owner.
create policy "house_plans_regulatory_sources_owner_all"
on house_plans_regulatory_sources
for all
to authenticated
using (has_workspace_access(owner_id))
with check (has_workspace_access(owner_id));
