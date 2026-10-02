# Work Package Lifecycle — Rung 0

Status, readiness, schedule state, and completion evidence are four different
things. This lifecycle governs **status** only. Readiness is evaluated
separately (`readiness-model.md`); a package can be `In Progress` on status
while a readiness gate reads `not ready` — that contradiction is signal, not
a bug, and the UI shows both.

## States

```
Draft → Planned → Readiness Review → Ready → In Progress → Complete → Verified/Closed
                  ↘ Blocked ↗              ↘ Blocked ↗
```

- **Draft** — being scoped. Editable freely. No commitments.
- **Planned** — scope, dates, responsibility, and package type set. Eligible
  for readiness evaluation.
- **Readiness Review** — gates being evaluated (`readiness-model.md`).
- **Ready** — all applicable gates `ready`. (Gates marked `not_applicable`
  with provenance count as satisfied.)
- **In Progress** — work started. Sets `actual_start`.
- **Blocked** — work stopped by a named blocker. Entered only from Draft,
  Planned, Readiness Review, Ready, or In Progress (see matrix). Records
  `blocked_reason`, `blocked_since`, `blocked_from`, and the blocking gate
  or issue reference. Leaving Blocked returns to exactly `blocked_from`,
  never forward.
- **Complete** — work reported complete. Sets `actual_finish`. Not yet
  verified.
- **Verified/Closed** — completion verified against criteria + evidence by an
  authorized person. Terminal: exited only by the explicit reopen row below.
- **Cancelled** — terminal; exited only by the explicit reopen row below. It
  is not "deleted"; it requires a reason.

## Transition matrix (deterministic, exhaustive)

No transition exists except the rows below. Anything else is rejected
deterministically.

| From → To | Requires | Audit |
|---|---|---|
| Draft → Planned | title, package_type, planned dates, responsible party | actor, at |
| Planned → Readiness Review | scope baseline frozen (`scope_baseline_id` set) for industrial packages; scope text present for all | actor, at |
| Readiness Review → Ready | every applicable gate `ready` (deterministic evaluation; interim rule below) | actor, at, gate snapshot ref |
| Ready → In Progress | user-confirmed start; sets `actual_start` | actor, at |
| Draft → Blocked | named reason + source (gate or issue id); records `blocked_from = Draft` | actor, at, reason |
| Planned → Blocked | named reason + source; records `blocked_from = Planned` | actor, at, reason |
| Readiness Review → Blocked | named reason + source; records `blocked_from = Readiness Review` | actor, at, reason |
| Ready → Blocked | named reason + source; records `blocked_from = Ready` | actor, at, reason |
| In Progress → Blocked | named reason + source; records `blocked_from = In Progress` | actor, at, reason |
| Blocked → *blocked_from* | blocker cleared with evidence, or accepted override (authorized, audited) | actor, at, evidence/override ref |
| In Progress → Complete | `percent_complete = 100` on the package's progress basis (0–100 scale), or explicit completion report with reason; sets `actual_finish` | actor, at |
| Complete → Verified/Closed | completion criteria met + required evidence present + verifier identity + `verified_at` | verifier, at, criteria checklist ref |
| Complete → In Progress | **verification rejected → rework:** verifier identity + rejection reason; clears `actual_finish` (the work is no longer reported complete) | verifier, at, reason |
| Verified/Closed → In Progress | **reopen:** workspace owner or designated verifier + reason; clears `verified_at`; the package returns to work, never straight back to Complete | actor, at, reason |
| Cancelled → Draft | **reopen:** workspace owner or designated verifier + reason | actor, at, reason |
| any non-terminal → Cancelled | required reason | actor, at, reason |

Rules:

- `actual_start` is set only by Ready → In Progress. `actual_finish` is set
  only by entry to Complete, and cleared by Complete → In Progress (rework)
  and by both reopen rows.
- Every transition writes an audit record: package id, from → to, actor
  (acting user id — distinct from the workspace `owner_id`), at,
  reason/note.
- Permissions: any transition requires workspace access
  (`has_workspace_access(owner_id)` semantics). Verification, gate
  overrides, and reopen transitions additionally require the workspace owner
  or a designated verifier recorded on the package.
- Terminal states (Verified/Closed, Cancelled) are exited only by their
  explicit reopen rows — never by Blocked, never silently.

## Interim rule (Rung 1 implements this matrix; Rung 3 and Rung 10 come later)

Rung 1 implements the full matrix above, but the readiness engine (Rung 3)
and the verification criteria (Rung 10) are the authoritative inputs it will
eventually read. Until they ship:

- Readiness Review → Ready evaluates gates from **explicit human
  attestations** recorded per gate (attestor identity, at, statement) —
  never from absence.
- Complete → Verified/Closed uses the package's recorded completion-criteria
  checklist plus linked evidence health (all required evidence links
  `resolved_state = ok`).

Implementers use these interim inputs. They do not invent their own.
- Status never implies readiness: the dashboard shows status and readiness
  side by side, always.
- The rental maintenance work-order state machine
  (`draft → assigned → scheduled → in_progress → completed → cancelled`) is
  separate and stays authoritative for rental repairs; a package linked to a
  work order (`realized_as`) reads that state but does not mirror it.
