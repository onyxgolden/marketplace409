-- HOUSE PLANS (HP-L6) Texas reference seed — curated official-source index.
--
-- Link-only scope: these rows are FACTUAL METADATA ONLY (titles, section
-- identifiers, issuing authority/jurisdiction, official URLs, topic tags,
-- provenance, retrieval/verification dates). No summaries, no code text, no
-- paraphrase, no interpretation. FORGE links to official sources; it never
-- authors explanatory text about regulatory requirements.
--
-- Curated index, not a completeness claim: a small set of official Texas
-- and Southeast-Texas municipal sources verified by hand. Municipal entries
-- are directory entries (authority + topic), never statements about what a
-- city requires for any project.
--
-- Idempotent and owner-scoped: inserts the seed for every workspace owner
-- present at apply time; insert-if-absent by (owner_id, official_url), so
-- re-running changes nothing. LIMITATION: owners created after this
-- migration is applied do not receive these rows from this migration.
--
-- Generated from src/lib/housePlans/texasSourcesSeed.js (single source of
-- truth). Do not hand-edit the VALUES below; regenerate instead.

insert into house_plans_regulatory_sources (
  owner_id,
  title,
  section_identifier,
  issuing_authority,
  jurisdiction,
  edition,
  effective_date,
  official_url,
  topic_tags,
  provenance,
  retrieval_date,
  verification_date,
  jurisdiction_state
)
select
  owners.owner_id,
  seed.title,
  seed.section_identifier,
  seed.issuing_authority,
  seed.jurisdiction,
  seed.edition,
  seed.effective_date::date,
  seed.official_url,
  seed.topic_tags::text[],
  seed.provenance,
  seed.retrieval_date::date,
  seed.verification_date::date,
  seed.jurisdiction_state
from (select distinct id::text as owner_id from auth.users) as owners
cross join (values
    -- https://statutes.capitol.texas.gov/Docs/LG/htm/LG.214.htm
    ('Texas Local Government Code — Chapter 214, Municipal Regulation of Housing and Other Structures', '§214.212', 'Texas Legislature', 'Texas', NULL, NULL, 'https://statutes.capitol.texas.gov/Docs/LG/htm/LG.214.htm', '{"building-codes","municipal-authority"}', 'Official site of the Texas Legislature', '2026-09-23', '2026-09-23', 'VERIFIED_SOURCE'),
    -- https://tdi.texas.gov/tips/need-windstorm-inspection.html
    ('What you need to know about windstorm inspections', NULL, 'Texas Department of Insurance', 'Texas', NULL, NULL, 'https://tdi.texas.gov/tips/need-windstorm-inspection.html', '{"windstorm","inspections"}', 'Texas Department of Insurance', '2026-09-23', '2026-09-23', 'VERIFIED_SOURCE'),
    -- https://tdi.texas.gov/wind/prod/index.html
    ('TDI Product Evaluations index', NULL, 'Texas Department of Insurance', 'Texas', NULL, NULL, 'https://tdi.texas.gov/wind/prod/index.html', '{"windstorm","windows","doors"}', 'Texas Department of Insurance', '2026-09-23', '2026-09-23', 'VERIFIED_SOURCE'),
    -- https://tdi.texas.gov/WIND/documents/WPI-8-fact-sheet-eng-sp.pdf
    ('WPI-8 windstorm inspection fact sheet', NULL, 'Texas Department of Insurance', 'Texas', NULL, NULL, 'https://tdi.texas.gov/WIND/documents/WPI-8-fact-sheet-eng-sp.pdf', '{"windstorm","inspections"}', 'Texas Department of Insurance', '2026-09-23', '2026-09-23', 'VERIFIED_SOURCE'),
    -- https://beaumonttexas.gov/707/Building-Codes
    ('Building Codes — City of Beaumont', NULL, 'City of Beaumont', 'Beaumont, Texas', NULL, NULL, 'https://beaumonttexas.gov/707/Building-Codes', '{"building-codes","permits","inspections"}', 'City of Beaumont', '2026-09-23', '2026-09-23', 'VERIFIED_SOURCE'),
    -- https://beaumonttexas.gov/160/Adopted-Building-Codes
    ('Adopted Building Codes — City of Beaumont', NULL, 'City of Beaumont', 'Beaumont, Texas', NULL, NULL, 'https://beaumonttexas.gov/160/Adopted-Building-Codes', '{"building-codes","residential-code"}', 'City of Beaumont', '2026-09-23', '2026-09-23', 'VERIFIED_SOURCE'),
    -- https://www.portarthurtx.gov/
    ('City of Port Arthur — official website', NULL, 'City of Port Arthur', 'Port Arthur, Texas', NULL, NULL, 'https://www.portarthurtx.gov/', '{"building-codes","permits"}', 'City of Port Arthur — see the Permits & Inspections department', '2026-09-23', '2026-09-23', 'VERIFIED_SOURCE')
) as seed (
  title,
  section_identifier,
  issuing_authority,
  jurisdiction,
  edition,
  effective_date,
  official_url,
  topic_tags,
  provenance,
  retrieval_date,
  verification_date,
  jurisdiction_state
)
where not exists (
  select 1
  from house_plans_regulatory_sources existing
  where existing.owner_id = owners.owner_id
    and existing.official_url = seed.official_url
);

