# Object Relationship Contract — FORGE Work Management Rung 0

A minimal typed-link contract for expressing legitimate relationships between
Work Packages and existing FORGE domain objects. This is a *contract*, not a
graph database decision: it defines what a link means, what it must carry,
and what it must never do.

## Non-goals

- No universal object table. No copying of domain data into Work Management.
- No silent relationship inference. Every link is created by a known actor
  through a known path.
- No cross-owner references. A link whose endpoints have different `owner_id`
  values is rejected at write time.

## The link record

```
forge_work_links (proposed, Rung 2)
  owner_id            text    -- isolation key; both endpoints must share it
  id                  text    -- forge_wlink_<uuid>
  source_domain       text    -- e.g. 'workmgmt', 'scheduling', 'financial'
  source_type         text    -- e.g. 'work_package', 'schedule_block'
  source_id           text    -- canonical id in the source domain
  target_domain       text
  target_type         text
  target_id           text
  relationship_type   text    -- from the enumerated vocabulary below
  created_by          text    -- user id | 'system' | 'brain-proposal'
  created_at          timestamptz
  provenance          text    -- user_confirmed | deterministic_import | ai_proposed
  status              text    -- active | stale | broken  (default active)
  resolved_at         timestamptz  -- last time the target was verified resolvable
  resolved_state      text    -- ok | moved | unavailable
  annotation          jsonb   -- small typed extras (zone, activity_type,
                              -- evidence_meaning, revision ref); never domain data
  notes               text
```

Primary key `(owner_id, id)`. Unique `(owner_id, source_domain, source_type,
source_id, target_domain, target_type, target_id, relationship_type)` —
the same fact is recorded once.

## Relationship vocabulary (initial, extendable by review)

Work Package ↔ Schedule block
- `executes` — block executes (part of) the package
- `constrains` — block constrains package readiness/start
- `milestone_for` — block is a milestone of the package

Work Package ↔ Designer project
- `supported_by_drawing` — drawing supports the work
- `revision_ref` — (via annotation.revision) the referenced revision

Work Package ↔ Financial event
- `cost_attributed` — event cost attributed to the package (read-only)

Work Package ↔ Capture artifact
- `evidence_before | evidence_during | evidence_after`
- `evidence_completion` — claimed completion evidence (meaning assigned by
  the user/deterministic workflow that attached it, never inferred)
- `evidence_inspection`

Work Package ↔ Document
- `supporting_document`
- `closeout_document`
- `permit_document`

Work Package ↔ Maintenance work order
- `realized_as` — package work realized as a rental work order
- `contractor_via` — contractor/vendor reference

Work Package ↔ Person / Vendor / Contractor
- `responsible_party`
- `supplies_material` (vendor)

Work Package ↔ Asset (new in WP domain)
- `on_asset` — the tagged equipment/system the work is performed on
- `in_location` — unit/area/system or laydown/staging location

Project ↔ Work Package
- `contains_package`

Property ↔ Project
- `subject_of`

## Provenance rules

- `user_confirmed`: a person made or accepted the link in the app.
- `deterministic_import`: created by an import/migration with a recorded
  source (e.g. schedule `linked_entity_id` adoption).
- `ai_proposed`: Brain suggested it. It becomes usable as evidence only after
  a user confirms it (→ `user_confirmed`). Unconfirmed proposals are visible
  as proposals, never as facts.
- Unknown or missing targets stay missing: a link whose target cannot be
  resolved is marked `broken`, surfaced, and never silently dropped or
  auto-repaired.

## Resolver behavior

- Links are resolved lazily and cached with `resolved_at`/`resolved_state`.
- `stale`: target moved or its referenced revision is no longer current
  (drawing superseded, baseline replaced). The link stays; the UI says which
  reference is stale and what replaced it, when the source domain can say.
- Readers must handle `broken` explicitly — no join may assume resolvability.

## What links never do

- Never duplicate authoritative fields (amounts, dates, percents) into the
  link or the package. Read them live from the source domain at read time.
- Never grant access: link visibility follows the reader's domain permissions;
  the link itself confers none.
- Never cross owners.
