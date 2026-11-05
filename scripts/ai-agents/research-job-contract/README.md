# AI Lab P1-A — Research job contract

P1-A is the first of three separately reviewed P1 slices (brief:
`results/chatgpt/ai-lab-p1-research-job-definition-scope-2026-11-04.md`
in forge-ai-drop). It defines the versioned Research assignment job
contract and nothing else.

## What this slice contains

- `src/jobDefinition.js` — `JobDefinitionV1` schema + strict validation.
  Fields: `job_id` (`research-<slug>@<version>`, version bound to the
  suffix), `job_type` (`research` only), `version`, `operator_scope`
  (`operator_ref`, `workspace_ref`), `decision_owner`, `title`,
  `question`, `allowed_source_corpus_ids` (non-empty, unique slugs),
  `exclusions`, `deliverable_schema_version` (`workbench-item@1` only),
  `recurrence`, per-run `budget`, `status`, `provenance`. Unknown
  fields refuse; Proxies, accessors, and custom prototypes refuse
  without invoking traps; every rejection carries a named `JobRefusal`
  code (`BAD_JOB_ID`, `VERSION_MISMATCH`, `AMBIGUOUS_OWNERSHIP`,
  `MISSING_SOURCE_AUTHORIZATION`, `EXCESSIVE_BUDGET`,
  `NON_DISABLED_STATUS`, and others — see `src/errors.js`).
- `src/recurrence.js` — declarative recurrence rules (`daily`,
  `weekly`, `monthly` in an IANA zone) plus `nextDueAfter` /
  `previewOccurrences` preview math. Pure functions only.
- `src/identity.js` — definition hash (SHA-256 over canonical JSON),
  `run_id` derivation (definition hash + explicit invocation id, so a
  duplicate invocation cannot double-create items), run-scoped item
  keys, and stale-preview detection (a version change changes the
  hash, invalidating previews computed under the old definition).
- `src/budget.js` — per-run budget accounting. Caps come from the job
  definition and are themselves capped (64 items, 256 KiB, 64 tool
  calls); consumption refuses *before* the exceeding item is touched.
- `src/preview.js` — `buildPreview()`: validated definition +
  synthetic fixture corpus → `JobRunReceiptV1` + `WorkbenchItemV1`
  list. Items carry claim, evidence excerpt + SHA-256 citation-byte
  identity, kind (`fact` | `inference` | `proposal`), uncertainty,
  limitations, recommendation, proposed action, and initial decision
  status `PENDING`. Empty corpora yield a meaningful empty claim and
  zero items — never invented items. Admission is bounded and
  descriptor-safe: items are gated, validated, then budget-checked one
  index at a time, so items past a refusal point are never read, and
  the receipt's fixture-set hash covers the corpus id + admitted
  normalized items only (invocation-independent).
- `fixtures/` — synthetic-only corpora: the 8-item replay, a 3-item
  corpus for budget tests, and an empty corpus. All values are
  invented; nothing here is a real product specification.

## DST rules (pinned by tests)

- Missing local time (spring-forward gap, e.g. 02:30 on the day
  America/Chicago jumps 02:00 → 03:00): that day has **no**
  occurrence. The rule never shifts to an unasked-for time.
- Ambiguous local time (fall-back repeat, e.g. 01:30 twice): the
  **first** occurrence (earlier UTC instant) wins.
- Monthly day with no such day that month (day 31 in February): that
  month is **skipped**, never clamped.
- Weekly/daily times are wall-clock times in the job's zone; the UTC
  instant moves with DST, the local time does not.

## What this slice deliberately does NOT contain

- No transport or store adapter (P1-B maps these objects onto the P2a
  private Workbench store).
- No scheduler, cron, timer, queue, or background run of any kind.
  Recurrence is a stored declarative rule; `nextDueAfter` only
  *computes* what a rule would do, for preview display.
- No accept/reject transitions: items start `PENDING`; transitions
  live in the P1-B decision adapter.
- No UI, routes, migration, activation path, live network call,
  production read/write, or tenant/financial/enrollment data.
- No second store. P2a patterns were used as reference only; nothing
  here imports app code (zero imports outside this directory), so no
  shared code can regress from this slice.

## The DISABLED invariant

`status` must be exactly `DISABLED` — any other value refuses with
`NON_DISABLED_STATUS`, including `SYNTHETIC_PREVIEW` as a *job*
status. Preview invocations carry mode `SYNTHETIC_PREVIEW` as a
separate receipt field; a preview never converts a job to scheduled
or live. There is deliberately no code path that turns a
caller-supplied value into a live job.

## Run the tests

```sh
node tests/run-tests.js   # or: npm test (in this directory)
```

Pure Node 24, zero dependencies. Tests use `node:test` directly;
the runner executes each suite file in order and exits nonzero on
any failure.
