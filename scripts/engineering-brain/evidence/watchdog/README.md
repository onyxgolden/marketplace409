# Watchdog — Slice 4 (W1–W3 integration)

## What this is

The independent watchdog runner over the Runtime Coverage Registry.
Slices 1–3 built the inventory (what runs), the evidence adapters (how
to check), and the evaluator (covered/gap/unknown per capability). This
slice turns that into scheduled watchdog operation per the W1–W3
architecture verdict:

- **W1** — expected-slot computation with honest Chicago DST handling,
  and slot states: `pending`, `observed-success`, `confirmed-miss`,
  `ambiguous`, `configuration-error`.
- **W2** — an independent runner: evaluates the most recent expired slot
  per capability, dedupes alerts by (capability, slot), persists alert
  state. No refire path, no CRON_SECRET, no endpoint invocation.
- **W3** — diagnostic packets for every alert: expected slot, evidence
  queried, observed state, and human recovery instructions.

## Files

- `evaluateSlots.mjs` — `chicagoUtcOffsetHours`, `effectiveCronsForDate`,
  `expectedSlots`. Fixed-UTC crons fire at fixed UTC; DST-guarded pairs
  resolve to the slot matching today's Chicago offset (earlier UTC slot
  on CDT days, later on CST days); dual-fire pairs produce two slots.
- `runWatchdog.mjs` — `evaluateSlot`, `runWatchdog`, `diagnosticPacket`.
  Alert state persists to a JSON file (default
  `~/workspace/brain-watchdog/alert-state.json`).
- `watchdogCli.mjs` — live run (`--out`, `--state-file`); exit 1 when
  new alerts need attention, following the existing cron-checker pattern.
- `__tests__/watchdog.test.mjs` — 17 tests, all I/O faked.

## Slot-state semantics

- `pending`: grace has not expired — not evaluable yet.
- `observed-success`: attributable evidence timestamped inside the slot
  window ([expected − 1h, expected + grace]).
- `confirmed-miss`: grace expired, evidence source healthy, no
  attributable evidence in the window — ONLY for execution-attempt logs
  (`execution_record`) and workflow-exclusive sources. A missing GitHub
  Actions run alone is never sufficient; durable evidence is required.
- `ambiguous`: adapter failure, no attributable source, or business
  effects only (idle indistinguishable from missed, per the Slice 3
  review).
- `configuration-error`: the registry names a workflow file absent from
  the repo (registry/repo disagreement is a config failure, not a miss).

Grace: 3h for daily capabilities, 2h for twice-daily.

## Hard gates (architectural, tested)

- No automatic refire. The runner cannot invoke cron endpoints; it holds
  no credentials beyond read-only evidence access.
- No second firer: the runner only reads.
- Alert dedupe: one alert per (capability, slot); repeat runs stay quiet;
  recovery marks the alert resolved.
- Diagnostic packets name the authorized recovery path
  (`execution_path`) and state plainly that refire is a human action.

## Operating notes

- Run this from a scheduler **independent of GitHub Actions** (the Muse
  runtime cron or a host cron). A GitHub scheduling outage must not be
  able to suppress both the firer and the watchdog.
- The CLI fails soft without credentials: adapters fail closed
  per-source and slots report `ambiguous` rather than crashing.
- Alert state is local runtime state, not code — it lives outside the
  repo by default.
