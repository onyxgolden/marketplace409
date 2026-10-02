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
  source_locator      text    -- typed locator where applicable, e.g.
                              -- 'schedule:block:<id>@<revision>',
                              -- 'designer:project:<id>:rev<n>',
                              -- 'git:<sha>:<path>'; nullable
  source_version      text    -- version/revision of the source state observed
  target_domain       text
  target_type         text
  target_id           text
  relationship_type   text    -- from the enumerated vocabulary below;
                              -- canonical orientation fixed per type
  created_by          text    -- user id | 'system' | 'brain-proposal'
  created_at          timestamptz
  observed_at         timestamptz  -- when the linked source state was observed
  provenance          text    -- user_confirmed | deterministic_import | ai_proposed
  confirmed_by        text    -- actor who last confirmed (null until confirmed)
  confirmed_at        timestamptz
  status              text    -- unresolved | active | stale | broken
                              -- (default unresolved)
  resolved_at         timestamptz  -- last time the target was verified resolvable
  resolved_state      text    -- ok | moved | unavailable
  annotation          jsonb   -- small typed extras (zone, activity_type,
                              -- evidence_meaning, revision ref); never domain data
  notes               text
```

Primary key `(owner_id, id)`. Unique `(owner_id, source_domain, source_type,
source_id, target_domain, target_type, target_id, relationship_type)` —
the same fact is recorded once, in its canonical orientation. Recording the
reverse orientation is rejected: the uniqueness key plus the fixed
orientation per type below forbid reverse duplicate facts.

## Confirmation history (immutable)

Accepting an `ai_proposed` link by flipping the enum to `user_confirmed`
would lose the original proposal provenance and the confirming actor/time.
Instead:

```
forge_work_link_confirmations (proposed, Rung 2)
  owner_id            text
  link_id             text    -- the forge_work_links id
  confirmed_by        text    -- acting user id (never 'brain-proposal')
  confirmed_at        timestamptz
  prior_provenance    text    -- what the link was before this confirmation
  note                text
```

Append-only. Accepting a proposal inserts a confirmation row and sets the
link's `provenance = user_confirmed`, `confirmed_by`, `confirmed_at`. The
original proposal (`created_by = 'brain-proposal'`, `created_at`, and every
prior confirmation row) is preserved forever. Brain-integration evidence
chains cite the full confirmation history, not just the latest enum value.

## Relationship vocabulary (initial, extendable by review)

Each relationship type has a **fixed canonical orientation** and **allowed
endpoint types**. A link recorded in the reverse orientation is rejected at
write time — the orientation rule plus the directional uniqueness key forbid
reverse duplicate facts.

| relationship_type | canonical source | canonical target | meaning |
|---|---|---|---|
| `executes` | scheduling.schedule_block | workmgmt.work_package | block executes (part of) the package |
| `constrains` | scheduling.schedule_block | workmgmt.work_package | block constrains package readiness/start |
| `milestone_for` | scheduling.schedule_block | workmgmt.work_package | block is a milestone of the package |
| `supported_by_drawing` | workmgmt.work_package | designer.designer_project | drawing supports the work (`annotation.revision` = referenced revision) |
| `cost_attributed` | financial.financial_event | workmgmt.work_package | event cost attributed to the package (read-only) |
| `evidence_before` / `evidence_during` / `evidence_after` | capture.capture_artifact | workmgmt.work_package | artifact as phase evidence (meaning assigned by the attaching user/workflow, never inferred) |
| `evidence_completion` | capture.capture_artifact | workmgmt.work_package | claimed completion evidence |
| `evidence_inspection` | capture.capture_artifact | workmgmt.work_package | inspection evidence |
| `supporting_document` | workmgmt.work_package | documents.rental_document | supporting material |
| `closeout_document` | workmgmt.work_package | documents.rental_document | closeout material |
| `permit_document` | workmgmt.work_package | documents.rental_document | permit record |
| `realized_as` | workmgmt.work_package | rental.rental_maintenance_work_order | package work realized as a rental work order |
| `contractor_via` | workmgmt.work_package | rental.rental_contractor | contractor/vendor reference |
| `responsible_party` | workmgmt.work_package | people.* / rental.rental_vendor | responsibility reference |
| `supplies_material` | rental.rental_vendor | workmgmt.work_package | vendor supplies material |
| `on_asset` | workmgmt.work_package | workmgmt.forge_work_asset | the tagged equipment/system the work is performed on (asset entity defined in `work-package-domain.md`) |
| `in_location` | workmgmt.work_package | workmgmt.forge_work_location | unit/area/system or laydown/staging location |
| `contains_package` | workmgmt.project | workmgmt.work_package | project contains package |
| `subject_of` | property.investor_property | workmgmt.project | project concerns property |

## Provenance rules

- `user_confirmed`: a person made or accepted the link in the app. Every
  acceptance writes a `forge_work_link_confirmations` row (confirmer,
  time, prior provenance) — the enum flip never stands alone.
- `deterministic_import`: created by an import/migration with a recorded
  source (e.g. schedule `linked_entity_id` adoption) in `source_locator`.
- `ai_proposed`: Brain suggested it. It becomes usable as evidence only after
  a user confirms it (→ confirmation row + `user_confirmed`). Unconfirmed
  proposals are visible as proposals, never as facts.
- Unknown or missing targets stay missing: a link whose target cannot be
  resolved is marked `broken`, surfaced, and never silently dropped or
  auto-repaired.

## Resolver behavior

- Both endpoints are validated at creation: the source and target must
  resolve to real records of the allowed types, or the write is rejected.
  An unchecked link never defaults to `active`.
- New links start at `status = unresolved`. The first successful resolution
  promotes to `active`; a failed one marks `broken`.
- Links are re-resolved lazily and cached with `resolved_at`/`resolved_state`.
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
