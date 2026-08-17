# Handover Package — Scheduling Engine (409 Marketplace)

**For:** Claude Code session(s) building this feature
**Prepared by:** Claude (chat) design/planning session with Jason
**Status:** Pre-implementation — no code written against the repo yet. This is a fresh feature kickoff, not a mid-work handoff.

---

## 1. Objective

Build a full scheduling module (Gantt/wall-board style, CPM-capable) as a new feature embedded inside 409 Marketplace — not a standalone app. Starting point is a working single-file HTML/JS prototype (drag-and-drop wall board) that proved the interaction model; this work ports and extends that into a real, persisted, dependency-aware scheduling engine.

## 2. Required reading before starting

Two artifacts from the design session are the source of truth for scope and architecture. **Read both in full before writing any code.**

1. **`scheduling-engine-spec.md`** — the full design spec: data model (8 tables), CPM engine design, constraint types, hammock activities, calendar model, UI additions, export plan (.xer / Project XML), and the 9-phase build order. Place this at `docs/scheduling/SPEC.md` in the repo if it isn't already there.
2. **`wallboard.html`** — the working prototype. Single-file vanilla HTML/CSS/JS: drag blocks from a categorized palette onto a week-based calendar grid, move/resize via mouse events, lanes, milestones (diamonds), JSON export/import, auto-save via a storage API. This is the interaction model to port into a React component — not a mockup to redesign from scratch. Place at `docs/scheduling/prototype.html` for reference during the port.

Also read `FORGE_CONSTITUTION.md` and skim `src/forge-os/` for the project's existing engineering discipline conventions (see §4 below) — this feature should follow the same discipline already established in the repo, not introduce a new style.

## 3. Context: what 409 already is

- Repo: `github.com/onyxgolden/marketplace409`, live at `marketplace409.vercel.app`
- Stack: Next.js 16 / React 19, Supabase (Postgres/auth/storage), Vitest, deployed on Vercel
- 409 combines three things today: a local buy/sell marketplace, real-estate/rental portfolio tools (rental manager, now tied into Stripe), and FORGE (financial ledger/reporting/intelligence layer)
- Navigation is being redesigned toward a **multi-app hub/chooser landing page** (marketplace, rentals, forge, dev — scheduling will be a new tile here) with a left sidebar app switcher and a right-side icon-only utility rail. Check current state of this redesign before wiring in the scheduling icon — it may already be in progress or partially shipped.
- Existing precedent for framework-agnostic, testable core logic: `scripts/governance/reviewedSessionMetadataContract.mjs` (plain ESM, importable from both `scripts/` and `src/`). The CPM engine should follow this same pattern — pure, framework-agnostic functions, not tangled into a React component.

## 4. Architectural constraints (carry over from FORGE_CONSTITUTION.md)

- TDD — tests before/alongside implementation, not after
- Immutability where the existing codebase uses it (e.g. computed schedule fields like early/late start/finish should be treated as engine output, not directly user-editable state)
- Layered architecture — keep the CPM engine, the Supabase data layer, and the React UI in separate, independently testable layers
- One-responsibility commits
- Docs must match reality — if `docs/scheduling/SPEC.md` diverges from what actually gets built (and it will, in places, as real constraints surface), update the doc in the same commit, don't let it go stale

## 5. Key decisions already made (do not re-litigate without flagging to Jason first)

- Scheduling is its **own standalone entity** (`schedule_projects`), not tied to a property — it has an *optional* polymorphic link (`linked_entity_type` + `linked_entity_id`) so it can attach to a property when relevant but doesn't require one
- Must support **any project type** (capital/industrial, commercial construction, residential construction, custom) — the palette/starter-block set is a swappable per-type template, not hardcoded
- Starter template already fully designed for capital/industrial (5 categories: Governance, Engineering, Procurement, Field Execution, Shutdown & Startup) — commercial and residential templates still need real content, only sketched in the spec
- Export targets: **Primavera P6 (`.xer`)** — directly generatable, documented text format — and **Microsoft Project via Project XML** (not native `.mpp` — that's proprietary binary and not worth attempting; Project XML is what MS Project itself opens and can re-save as `.mpp`)
- Monetization: keep free within 409 while it builds out; may split into a separately-charged app later once it's proven/dependency-rich. This has **no bearing on the architecture** other than: keep the scheduling engine cleanly separable from 409-specific concerns (already satisfied by the polymorphic-link design), so a future spinout doesn't require a rewrite.
- Build order is specified in the spec §7 — schema → port prototype into React/Supabase (incl. landing-page icon) → dependencies/drawer → calendars → CPM engine → constraints → hammocks → lane/color polish → exporters last. Exporters are explicitly last because they're meaningless without real dependency/calendar/constraint data.

## 6. Definition of done (per phase, general pattern)

For each phase in the spec's build order:
- Schema changes (if any) migrated and RLS scoped consistently with the rest of 409
- New/changed logic has passing tests (Vitest), following existing repo test conventions
- Full test suite still green, full build clean, before commit
- `docs/scheduling/SPEC.md` updated if implementation diverged from the written design
- Commit scoped to one responsibility, with a clear message
- Feature is usable/visible at that phase's level (per spec §7 — e.g. after phase 2 the board should be live in the app, not just in the database)

## 7. Suggested first session scope

Phase 1 (schema migration) + start of Phase 2 (component port, local-state-only, no Supabase wiring yet) is a reasonable first-session boundary — small enough to land cleanly, and lets Jason see the board rendering inside 409's actual UI before any persistence work begins.

Before writing migrations, inspect:
- How existing tables handle org/user ownership and RLS (mirror that pattern exactly, don't invent a new one)
- Current state of the landing-hub navigation redesign, so the scheduling icon slots into whatever pattern already exists (or is being built) rather than a one-off

## 8. Open items / things not yet decided

- Exact content of the commercial and residential starter templates (only capital/industrial is fully specified)
- Whether `schedule_calendars` with `schedule_project_id IS NULL` (global/reusable calendars) ships in v1 or is deferred — spec allows for it but it's not required for phase 1–2
- Icon/visual design for the scheduling tile on the landing hub — not specified, needs a design pass whenever that phase comes up
