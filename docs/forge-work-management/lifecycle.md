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
- **Blocked** — work stopped by a named blocker. Entered from Planned,
  Readiness Review, Ready, or In Progress. Records `blocked_reason`,
  `blocked_since`, and the blocking gate or issue reference. Leaving Blocked
  returns to the prior state, never forward.
- **Complete** — work reported complete. Sets `actual_finish`. Not yet
  verified.
- **Verified/Closed** — completion verified against criteria + evidence by an
  authorized person. Terminal. Reopening requires a new package or an
  explicit reopen event (audited).

## Transition requirements

| Transition | Requires |
|---|---|
| Draft → Planned | title, package_type, planned dates, responsible party |
| Planned → Readiness Review | scope baseline frozen (`scope_baseline_at` set) for industrial packages; scope text present for all |
| Readiness Review → Ready | every applicable gate `ready` (deterministic evaluation) |
| Ready → In Progress | user-confirmed start; sets `actual_start` |
| Any → Blocked | named reason + source (gate or issue id) |
| Blocked → prior | blocker cleared with evidence or accepted override (audited) |
| In Progress → Complete | `percent_complete = 100` by the package's progress basis, or explicit completion report with reason |
| Complete → Verified/Closed | completion criteria met + required evidence present + verifier identity + verified_at |

Illegal transitions are rejected deterministically. Every transition writes
an audit record: package id, from → to, actor, at, reason/note.

## Notes

- `Cancelled` is a terminal state reachable from any non-terminal state, with
  a required reason. It is not "deleted".
- Status never implies readiness: the dashboard shows status and readiness
  side by side, always.
- The rental maintenance work-order state machine
  (`draft → assigned → scheduled → in_progress → completed → cancelled`) is
  separate and stays authoritative for rental repairs; a package linked to a
  work order (`realized_as`) reads that state but does not mirror it.
