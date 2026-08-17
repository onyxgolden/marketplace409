# Scheduling Engine — Design Spec

**Project:** Scheduling module for 409 Marketplace (schedule projects, embeddable feature)
**Status:** Draft for build planning
**Origin:** Extends the wall-board Gantt prototype into a CPM-capable scheduling engine comparable in scope to core Primavera P6 / Microsoft Project functionality.

---

## 1. Overview & Goals

The wall-board prototype (single-file HTML tool) proved the visual interaction model: drag blocks onto a week-based calendar, resize to set duration, organize into lanes. This spec extends that into a real scheduling engine, embedded in 409 rather than standalone, with:

- Task numbering, typed dependencies, and derived (CPM) scheduling
- Calendars (working days + holidays) per project or per lane
- Constraint types (Start On, Finish By, etc.)
- Hammock/summary activities
- Customizable lanes, colors, and project-type starter templates
- Export to Primavera P6 (.xer) and Microsoft Project (Project XML, MSP-openable)

**Non-goals for v1:** resource loading/leveling, cost tracking, multi-project resource contention, baseline comparison/variance reporting. These are natural P6/MSP features but out of scope until the core engine is solid — flagged here so they're not forgotten, not because they're unimportant.

**Use case breadth:** the engine must not assume any one industry. Project type (capital/industrial, commercial construction, residential construction, custom) only determines which *starter template* of lanes/blocks loads — the underlying schema is generic.

---

## 2. Data Model

All tables live in 409's existing Supabase/Postgres instance, scoped by the same ownership and RLS pattern as the rest of the app — confirmed against `supabase/migrations/20260812000300_create_rent_schedules_and_charges.sql` before writing the scheduling migration. That pattern, mirrored exactly (see `supabase/migrations/20260817000100_create_scheduling_engine.sql`):

- **No `org_id` anywhere in this codebase** — every table uses `owner_id`, and every table PK is `text`, not native `uuid`. IDs are app-generated as `<prefix>_<uuid>` (e.g. `schedule_project_<uuid>`), not DB-default `gen_random_uuid()`.
- Every owner-scoped table has a **composite primary key `(owner_id, id)`**, and every foreign key to another owner-scoped table is the composite pair `(owner_id, x_id)` — never a bare `id` FK. This is what makes RLS enforcement airtight: a row can only ever reference another row already scoped to the same owner.
- RLS is `enable` + `force` on every owner-scoped table, with a single `for all to authenticated using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text)` policy. There is currently only one actor type in scheduling (the owner) — no tenant-style read-only cross-actor policy is needed here (unlike, say, `rent_schedules`, which also grants tenants read access to their own lease's schedule).
- `schedule_templates` is the one exception: it's system-seeded reference data, not owner data, so it has no `owner_id` at all and gets RLS `enable`/`force` plus a single `for select to authenticated using (true)` policy — readable by anyone signed in, writable only via migration/service role.

Every `uuid pk`/`uuid fk` below is `text` in the implemented migration (app-generated prefixed id, composite-keyed as described above) — the table shapes are otherwise accurate to what's implemented.

### 2.1 `schedule_projects`
| column | type | notes |
|---|---|---|
| id | text pk | app-generated, prefixed (`schedule_project_<uuid>`) |
| owner_id | text | ownership; composite PK `(owner_id, id)`, same pattern as rest of 409 |
| name | text | |
| project_type | text | `capital_industrial`, `commercial_construction`, `residential_construction`, `custom` — determines starter template on creation only |
| start_date | date | |
| end_date | date | |
| default_calendar_id | text fk → schedule_calendars | project-level default |
| linked_entity_type | text, nullable | e.g. `'property'` — optional |
| linked_entity_id | text, nullable | polymorphic link; a schedule does **not** require a property |
| created_at / updated_at | timestamptz | |

### 2.2 `schedule_templates` (system-seeded, not user table)
Defines the starter lane/block set loaded when a project is created with a given `project_type`. One row per template; template content is JSON (lane names + default colors + starter block chips with default durations/milestone flags), consumed at project-creation time to seed real `schedule_lanes` rows — after that, the template has no further effect and each project's lanes are fully independent/editable.

Starter templates to build:
1. **Capital / Industrial** — the 5-category set already built (Governance, Engineering, Procurement, Field Execution, Shutdown & Startup)
2. **Commercial Construction** — e.g. Permitting, Sitework, Foundation, Structure, Envelope, MEP Rough-in, Interior Finish, Inspections/Closeout
3. **Residential Construction** — e.g. Permitting, Framing, Roofing, Rough-ins (plumbing/electrical/HVAC), Drywall, Trim/Finish, Final Inspection
4. **Custom / Blank** — empty lane set, user builds from scratch

**Implemented (phase 1):** `id text pk` (fixed ids, e.g. `schedule_template_capital_industrial`), `project_type text`, `name text`, `template jsonb`, no `owner_id`. Seeded in `supabase/migrations/20260817000200_seed_scheduling_templates.sql` via `insert ... on conflict (id) do update`, so re-running the migration is idempotent. All four templates are seeded; only capital/industrial is real, fully-ported content (from the prototype's `DEFAULT_LANES`/`DEFAULT_CHIPS`) — commercial and residential are intentionally sketch-level (one lane per named category, one starter milestone + one generic task chip each), matching the "still need real content" note above. Chip durations are stored as `durationWeeks`, matching the week-granularity board being ported in phase 2 — **not** the same unit as `schedule_blocks.duration_days` below. Reconciling week-placed board content into day-granular persisted blocks is a phase 3+ (Supabase-wiring) concern, not decided yet.

### 2.3 `schedule_lanes`
| column | type | notes |
|---|---|---|
| id | text pk | |
| schedule_project_id | text fk | |
| name | text | user-editable, no fixed enum |
| color | text (hex) | user-editable, defaults from template |
| calendar_id | text fk → schedule_calendars, nullable | overrides project default calendar for tasks in this lane (e.g. field-execution lane on a 6-day site calendar) |
| sort_order | int | |

### 2.4 `schedule_blocks` (tasks/activities)
| column | type | notes |
|---|---|---|
| id | text pk | |
| task_code | text | stable, auto-incrementing, human-facing (e.g. `A1010`, `A1020`); assigned at creation, never reused |
| schedule_project_id | text fk | |
| lane_id | text fk | |
| label | text | |
| category | text | governance/engineering/procurement/field/shutdown/custom — drives default color, purely descriptive |
| block_type | text | `task` \| `milestone` \| `hammock` |
| start_date | date | for `task`/`milestone`; ignored/derived for `hammock` |
| duration_days | int | working days per assigned calendar; 0 for milestone; derived for hammock |
| calendar_id | text fk, nullable | overrides lane/project calendar for this one task |
| constraint_type | text, nullable | see §5 |
| constraint_date | date, nullable | paired with constraint_type |
| early_start / early_finish / late_start / late_finish | date | **computed**, not user-edited — written by the CPM engine (§4) |
| total_float_days | int | computed |
| is_critical | boolean | computed (total_float = 0, or per critical-path definition) |
| created_at / updated_at | timestamptz | |

### 2.5 `schedule_dependencies`
| column | type | notes |
|---|---|---|
| id | text pk | |
| predecessor_id | text fk → schedule_blocks | |
| successor_id | text fk → schedule_blocks | |
| relationship_type | text | `FS` (Finish-to-Start) \| `SS` \| `FF` \| `SF` |
| lag_days | int | signed; negative = lead |

### 2.6 `schedule_hammock_anchors`
Hammock blocks (block_type = `hammock`) don't get normal dependency rows for their span — they reference the set of blocks that define their derived start/finish.

| column | type | notes |
|---|---|---|
| id | text pk | |
| hammock_block_id | text fk → schedule_blocks | |
| anchor_block_id | text fk → schedule_blocks | |
| anchor_role | text | `start` \| `finish` \| `both` — `both` = included in min(start) and max(finish) calc; `start`/`finish` = only drives that end |

### 2.7 `schedule_calendars`
| column | type | notes |
|---|---|---|
| id | text pk | |
| schedule_project_id | text fk, nullable | nullable = reusable calendar across this *same owner's* projects — not a cross-user/global calendar; every row is still `owner_id`-scoped like everything else in this schema, same as the rest of 409 today (single-owner-at-a-time RLS, no cross-owner sharing anywhere in the codebase) |
| name | text | e.g. "5-Day Office", "6-Day Site" |
| working_days | jsonb | e.g. `{mon:true, tue:true, ... sun:false}` |

**Implementation note:** `schedule_projects.default_calendar_id` and `schedule_calendars.schedule_project_id` reference each other, which is a genuine circular dependency at table-creation time. Resolved by creating `schedule_calendars` first (without its FK to `schedule_projects` declared inline), then `schedule_projects` (with its FK to `schedule_calendars` declared inline, since that table already exists), then adding `schedule_calendars`' reverse FK via `alter table ... add constraint` once both tables exist. See the migration for the exact ordering.

### 2.8 `schedule_calendar_holidays`
| column | type | notes |
|---|---|---|
| id | text pk | |
| calendar_id | text fk | |
| holiday_date | date | |
| label | text | e.g. "Thanksgiving", "Company Shutdown" |

---

## 3. Constraint Types (§ maps directly to P6/MSP for clean export)

| type | behavior |
|---|---|
| ASAP (default) | no constraint; pure dependency-driven |
| ALAP | slides as late as possible without delaying successors |
| Start On | pinned start date; soft — dependency logic can still flag conflicts |
| Finish On | pinned finish date |
| Start No Earlier Than (SNET) | clamps early start lower bound |
| Start No Later Than (SNLT) | clamps late start upper bound |
| Finish No Earlier Than (FNET) | clamps early finish lower bound |
| Finish No Later Than (FNLT) | clamps late finish upper bound |
| Must Start On | hard constraint — overrides dependency-calculated date entirely |
| Must Finish On | hard constraint — overrides dependency-calculated date entirely |

Hard constraints (Must Start/Finish On) can create scheduling conflicts with predecessors — the engine should surface these as warnings (matching P6's constraint-violation flag) rather than silently resolving them.

---

## 4. CPM Scheduling Engine

Pure function(s), framework-agnostic (same spirit as 409's existing `reviewedSessionMetadataContract.mjs` — plain, testable, importable from both server and any script context), operating on a project's full block/dependency/calendar/constraint graph:

1. **Forward pass** — walk blocks in dependency order, compute Early Start/Early Finish per block from predecessors' relationship type + lag, respecting each block's assigned calendar (skip non-working days) and any soft-constraint lower bounds.
2. **Backward pass** — from project finish, compute Late Start/Late Finish per block from successors, respecting soft-constraint upper bounds.
3. **Float** — Total Float = Late Start − Early Start. Critical path = blocks with zero (or minimum) float.
4. **Hammock resolution** — after the main pass, compute each hammock's start = min(anchor starts where role ∈ {start, both}), finish = max(anchor finishes where role ∈ {finish, both}).
5. **Constraint conflict detection** — flag any block where a hard constraint date falls before its dependency-calculated Early Start (or otherwise makes the constraint unsatisfiable).

Recompute triggers: any dependency add/remove, block move/resize, constraint change, or calendar change for blocks in that project. For UI responsiveness, recompute can run client-side on edit (same engine, compiled/shared) and persist the result on save — not require a server round-trip per drag.

---

## 5. UI / Interaction Additions (on top of the existing wall-board prototype)

- **Task numbering**: every block shows its `task_code`; assigned automatically, immutable.
- **Dependency drawer**: selecting a block opens a bottom panel with two lists — Predecessors and Successors — each row showing linked task code, name, relationship type, and lag. Add/remove links here. The board renders an arrow between linked blocks.
- **Suggested ties**: on placing/moving a block, check for blocks in the same or adjacent lane ending at/near the new block's start; surface those as one-click "add as predecessor?" suggestions in the drawer — never auto-created silently.
- **Calendar rendering**: non-working days and holidays render as a greyed vertical band across the grid, calculated per the calendar assigned to whichever lane/block is being viewed (project default unless overridden).
- **Hammock blocks**: visually distinct (striped/hatched fill or outline style) from normal task bars; not directly draggable/resizable — span is derived and redraws automatically when anchors change. Created via an "anchor picker" (select 2+ existing blocks, choose start/finish/both role per anchor).
- **Constraint marker**: a small flag/bracket icon on any block with an active constraint, so pinned vs. float-driven bars are visually distinguishable at a glance.
- **Lane customization**: add lane (already built), plus a color picker per lane (replacing the fixed category-color mapping) and free-text lane naming (already supports this).

---

## 6. Export Plan

### 6.1 Primavera P6 — `.xer`
Documented tab-delimited text format (table sections: `PROJECT`, `PROJWBS`, `TASK`, `TASKPRED`, `CALENDAR`, etc.). Directly generatable from the schema above:
- `schedule_projects` → `PROJECT`
- `schedule_lanes` → `PROJWBS` (WBS nodes)
- `schedule_blocks` → `TASK` rows (task_code, dates, calendar, constraint)
- `schedule_dependencies` → `TASKPRED`
- `schedule_calendars` + holidays → `CALENDAR`

Feasible as a straightforward serializer once the dependency/calendar/constraint data actually exists — no external library needed.

### 6.2 Microsoft Project — Project XML (not native `.mpp`)
Native `.mpp` is a proprietary compound-binary format not practical to hand-write. The standard approach (used by every third-party tool that claims ".mpp export," including Smartsheet/Asana/etc.) is Microsoft's documented **Project XML interchange schema** — MS Project opens this directly via File → Open and can re-save it as `.mpp` itself. Mapping is conceptually the same as the XER mapping above, targeting XML elements (`Tasks/Task`, `PredecessorLink`, `Calendars/Calendar`) instead of XER tables.

### 6.3 Sequencing note
Both exporters are only meaningful once dependencies, calendars, and constraints are real — exporting the current visual-only block data would produce technically valid but practically useless files (disconnected bars, no critical path). **Build order should be: schema → CPM engine → UI additions → exporters**, not the reverse.

---

## 7. Suggested Build Phases

1. **Schema migration** — all tables in §2, seeded with the 4 starter templates
2. **Port existing prototype** — wall-board HTML/JS logic → React component(s) in 409, backed by Supabase reads/writes instead of `window.storage`; verify drag/move/resize parity first with local state before wiring persistence
3. **Dependencies + drawer** — task numbering, predecessor/successor CRUD, arrow rendering, suggested-tie logic
4. **Calendars** — calendar CRUD, holiday lists, greyed non-working-day rendering
5. **CPM engine** — forward/backward pass, float, critical path highlighting
6. **Constraints** — constraint types, conflict flagging
7. **Hammocks** — anchor picker, derived-span rendering
8. **Lane/color customization** — color picker, template-driven lane seeding at project creation
9. **Exporters** — `.xer` first (simpler format, no proprietary reverse-engineering), then Project XML

Each phase is independently testable and shippable — the board is usable (as an upgraded version of the current prototype) after phase 2, and gains real scheduling power incrementally from there rather than requiring the whole engine before anything ships.
