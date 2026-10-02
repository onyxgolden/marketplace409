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

| Gate | Plain language | Satisfied when |
|---|---|---|
| scope | "Is the work defined?" | scope text present; scope baseline frozen for industrial packages |
| design | "Are the drawings ready?" | linked drawing reference current (not `stale`/`broken`) |
| predecessor | "What must finish first?" | constraining blocks/packages not blocking (from scheduling links) |
| material | "Are materials on hand?" | required items `received` (or explicitly `not_applicable`) |
| crew | "Who does the work?" | responsible party assigned and confirmed |
| permit | "Permits and inspections covered?" | required permits linked; inspection prerequisites scheduled |
| site | "Can we get to the work?" | site/access confirmed; logistics location reserved where needed |
| safety | "Safety prerequisites met?" | safety prerequisites confirmed; isolation/LOTO verified for industrial work on energized systems |
| evidence | "Do we have what we need on file?" | required documents/evidence present and resolvable |

Package templates declare which gates apply; irrelevant gates are
`not_applicable` with provenance — never silently skipped.

## Industrial gates (from the turnaround field model)

- **equipment_readiness** — "Is the equipment released to us?" The tagged
  asset is confirmed available (unit down / system isolated per the
  shutdown sequence); carries the zone/unit and the releasing authority.
- **inspection_prerequisite** — "Are required inspections done?" Per-component
  inspection state (`passed | failed | pending | not_applicable`), NDE method
  and quantity where applicable (e.g. tubes examined / tubes required),
  inspector or contractor attribution. Mirrors the field flagging discipline:
  passed / failed / not-inspected-or-under-evaluation.
- **logistics** — "Where do things go?" Named laydown/staging locations
  reserved and linked; heavy-lift/rigging needs flagged from component
  weights in the package's component list.

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
