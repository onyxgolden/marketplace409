# Readiness Model — Rung 0

Readiness answers one question: **can this work start?** It is evaluated
deterministically from gates, evidence, and linked domain state. It is never
an opaque score.

## Gate evaluation

Each gate resolves to one of:

- `ready` — satisfied, with evidence or a confirmed source
- `not_ready` — unsatisfied; carries a plain-language reason
- `unknown` — cannot be evaluated from available data (stays unknown; never
  inferred from absence)
- `not_applicable` — with provenance (who marked it N/A and why)

Each evaluation records: gate, state, reason, evidence/link reference,
`evaluated_at`, and the responsible source/domain. Re-evaluation is
triggered by: linked object changes, new evidence, gate override, or manual
refresh. Evaluations are append-only history; the package shows the latest
per gate.

## Standard gates

Each gate is satisfied only by its stated authoritative input or an explicit
human attestation. "Linked" is never enough on its own: a linked drawing is
not necessarily an approved drawing, a linked permit is not necessarily an
issued permit. **Missing approval or source capability evaluates `unknown`,
never `ready`.**

| Gate | Plain language | Satisfied when (exact input or attestation) |
|---|---|---|
| scope | "Is the work defined?" | scope text present (author attested); for industrial packages an immutable scope baseline version exists (`scope_baseline_id` set on the current baseline row per the derivation rule in `work-package-domain.md`) |
| design | "Are the drawings ready?" | `supported_by_drawing` link with `resolved_state = ok` **and** the referenced revision is the source domain's current revision **and** approval covers that same revision: either the source domain reports an authoritative approval for that revision (approval state + approved revision id), or an explicit human attestation "approved for construction" that names the revision it approves (attestor identity, at, revision). Missing approval (source cannot report it and no attestation) → `unknown`. An explicitly unapproved or rejected revision → `not_ready`. Approval of an old revision does **not** qualify a replacement revision: when the current revision changes, the gate returns to `unknown` until approval covers the new revision. |
| predecessor | "What must finish first?" | every linked `constrains` block/package is in a complete state (Complete/Verified, or the source work order's completed state) with its link `resolved_state = ok`, or the constraint is explicitly waived with provenance. "Not blocking" alone is not an executable predicate. |
| material | "Are materials on hand?" | every required item `received` with received evidence (or explicitly `not_applicable` with provenance). Anything less is `unknown` or `not_ready` with a reason — never ready by absence. |
| crew | "Who does the work?" | responsible party assigned **and** confirmed (confirmation record or attestation with identity + at). Assignment alone → `unknown`. |
| permit | "Permits and inspections covered?" | permit document linked **and** attested issued (`permit_number` + `issued_by` + `issued_at`, or explicit human attestation "permit issued" with attestor). Linked-but-unattested → `unknown`. |
| site | "Can we get to the work?" | site/access attested by a named authority (attestor, at); where the package needs one, a logistics location reserved (reservation record on `forge_work_locations`). |
| safety | "Safety prerequisites met?" | safety prerequisite checklist attested complete (attestor, at); for industrial work on energized systems, isolation/LOTO verified with verifier identity + at. |
| evidence | "Do we have what we need on file?" | required documents/evidence present **and** `resolved_state = ok`. |

Package templates declare which gates apply; irrelevant gates are
`not_applicable` with provenance (attestor + reason) — never silently
skipped. **Minimal applicable-gate configuration (before the Rung 13
template UI):** Rung 1 ships a default gate set per `package_type`,
documented in the Rung 1 spec; per-gate N/A attestation is always available.

## Industrial gates (from the turnaround field model)

- **equipment_readiness** — "Is the equipment released to us?" Satisfied by a
  release record or explicit attestation: the tagged asset (`forge_work_assets`
  id), the zone/unit, the releasing authority identity, and at. A shutdown
  sequence position alone, without the releasing authority, → `unknown`.
- **inspection_prerequisite** — "Are required inspections done?" Satisfied by
  `forge_work_inspection_observations` rows covering every required component:
  per-component status (`passed | failed | pending | not_applicable`), NDE
  method and quantity examined vs required, inspector attribution. Any required
  component with no observation → `unknown`. Mirrors the field flagging
  discipline: passed / failed / not-inspected-or-under-evaluation (= pending).
- **logistics** — "Where do things go?" Satisfied by reservation records on
  the named `forge_work_locations` (laydown/staging/workface); rigging needs
  flagged from component weights in `forge_work_asset_components`. No
  reservation → `unknown` or `not_ready` with reason.

## The readiness statement

A package must be able to say, in plain language:

> "Not ready: the bundle inspection is pending and the laydown area is not
> reserved."

…rather than "Readiness 63%." The dashboard lists each `not_ready`/`unknown`
gate with its reason and what would clear it.

## Overrides

A gate may be overridden to `ready` by an authorized person with a reason;
the override is recorded with actor, timestamp, and reason, and is visible
wherever the gate is shown. Overrides expire at a declared date or at the
next re-evaluation trigger, whichever comes first.

## Logistics locations (minimal entity)

```text
forge_work_locations (proposed, Rung 1/2)
  owner_id, id (forge_wloc_<uuid>),
  name, location_type (laydown | staging | workface | crane_position |
                       access_route | waste_point | trailer | other),
  unit, area, notes,
  reserved_by_package (nullable package ref + reserved window)
```

Full plot-plan integration is out of scope; named, reservable locations are
not — material readiness depends on knowing where things physically are.
