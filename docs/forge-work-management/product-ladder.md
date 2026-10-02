# Product Ladder — FORGE Work Management (amended Rung 0)

Build order. One rung at a time; review before proceeding. This ladder
incorporates ADR-004: industrial depth is in the core from Rung 0/1, not
deferred.

- **Rung 0 — Object graph + Work Package domain discovery.** This docs
  package. Inventory real domains, define the relationship contract, specify
  WP v1 (with industrial fields), lifecycle, readiness model, novice UX,
  Brain boundary. Deliverable: this directory + reviewed PR. Then STOP.
- **Rung 1 — Work Package core.** Implement the WP v1 spec
  (`work-package-domain.md`): owner isolation, code/title/scope, lifecycle,
  responsibility, dates, industrial context fields, components, earned-progress
  fields, scope baseline, audit/provenance, deterministic validation, RLS,
  domain tests. Minimal UI: create/open/edit a package. No cross-domain links
  yet. Logistics locations ship here (small entity, big readiness payoff).
- **Rung 2 — Typed object links.** Implement `forge_work_links` per
  `object-relationship-contract.md`: link/unlink, vocabulary, provenance,
  resolver states, stale/broken behavior, owner isolation. Start with the
  verified-small set: scheduling blocks, Designer projects, documents,
  maintenance work orders, contractors/vendors.
- **Rung 3 — Readiness engine.** Deterministic gate evaluation per
  `readiness-model.md`, including the industrial gates (equipment readiness,
  inspection prerequisite, logistics). Gate history, overrides with expiry,
  plain-language readiness statements.
- **Rung 4 — Scheduling integration.** Link blocks/milestones; predecessors
  and constraints feed readiness; planned/actual timing; critical-path/float
  visibility from the CPM engine. Wire the existing EVM functions
  (`schedulingEvmDcma.js`) to package earned progress. Zone/activity
  annotations on links enable the zone execution view (day-by-day by
  zone/unit, typed activities, named milestones).
- **Rung 5 — Drawings/documents/Designer integration.** Reference projects,
  sheets, revisions; show which reference is current vs stale/unavailable.
- **Rung 6 — Materials/procurement readiness.** Required items with
  quantity/unit, vendor, ordered/expected/received/shortage; feeds the
  material gate. No ERP.
- **Rung 7 — Field execution + Capture evidence.** Before/during/after and
  completion/inspection evidence with stated meaning and provenance; photo
  presence never auto-proves completion.
- **Rung 8 — Cost/financial attribution.** Read-only attribution of
  financial events to packages; roll-up and variance vs budget where a
  budget exists. Financial stays authoritative.
- **Rung 9 — Issues / RFIs / changes.** Issue/blocker, RFI-style question,
  decision, change; responsible party, due dates, resolution, linked
  evidence; impact fields where authoritative data supports them. Includes
  the late-work-request record type (scope grows only through it).
- **Rung 10 — Completion / verification / closeout.** Completion criteria,
  required evidence (including per-component inspection states),
  punch/open items, inspections, authorized verification, closeout documents.
  "Reported complete" vs "verified/closed" stay distinct.
- **Rung 11 — Work Management dashboard.** Today's executable work; ready /
  blocked / in progress with reasons; upcoming work; schedule impact;
  material constraints; issues/changes; evidence freshness; cost snapshot;
  program S-curve (planned vs earned vs actual) and scope-freeze status.
  Optimized for "what can happen and what is preventing it" — not a Kanban
  clone.
- **Rung 12 — Brain orchestration / Ask the Work.** Read-only Brain
  workflows over the mature contracts (`brain-integration.md`); proposals
  require acceptance.
- **Rung 13 — Templates.** Pre-filled configurations of the industrial-ready
  core: kitchen/bath remodel, rental turn, maintenance repair, new
  construction phase, engineering package, industrial work package,
  capital-project package. (Rescoped by ADR-004: configuration, not rescue.)

## Standing gates between rungs

- Exact-head ChatGPT review per the AI-team protocol before proceeding.
- No production migrations without Jason's explicit word.
- Conflict-marker grep on every head before merge.
- The portfolio rule from the program plan applies once this program starts
  building: new top-level apps should consume or provide data across at
  least two existing domains.
