# QA agent — Slice 2 (P3): the pre-merge test-runner

Runs named vitest suites on an **exact pinned HEAD** inside a checkout
the operator names, and emits a deterministic advisory report for the
panel flow. **Advisory only: it merges nothing, approves nothing, and
carries no authority.** It never checks out, fetches, pushes, or writes
into the target tree — the vitest JSON report is directed to a temp
directory outside the target.

Sibling of `qa-inspection-prototype/` (slice 1, untouched by this
slice). Implements brief
`commands/muse/qa-test-runner-slice1-brief-2026-10-22.md` in the
`onyxgolden/forge-ai-drop` coordination repo.

## Job spec (input)

```json
{
  "job_id": "optional-id",
  "target": "/abs/path/to/checkout",
  "head_pin": "40-hex-lowercase-commit",
  "suites": [
    { "id": "unit", "patterns": ["src/foo.test.js"], "timeout_ms": 60000 }
  ],
  "budgets": {
    "max_suites": 16,
    "max_patterns_per_suite": 32,
    "per_suite_timeout_ms": 60000,
    "per_job_timeout_ms": 300000,
    "max_captured_bytes_per_suite": 1048576
  }
}
```

Strict validation: unknown properties are refused everywhere, duplicate
suite ids are refused, the pin must be full 40-hex lowercase, and a
suite carries **only** an id + test-path patterns (+ optional timeout) —
free-form shell commands are refused structurally; argv is constructed
by the runner (`npx vitest run <patterns> --reporter=json
--outputFile <tmpfile outside the target tree>`), never taken from the
job. Patterns starting with `-` are refused (flag injection).

## Budgets — charged before execution

Every budget is charged **before** anything runs, walking the suites in
job order and charging each candidate (suite slot, pattern slots,
declared timeout) **before** that candidate's fields are validated. An
entry sitting past a limit therefore dies on `BUDGET_EXCEEDED` — never
on a validation error for its unexamined contents, and never by
running. Sentinel-proven in `tests/budget.test.js`. Hard caps:
16 suites, 32 patterns/suite, 120 s per suite, 600 s per job,
8 MiB captured per suite; a job may tighten budgets, never loosen them.
Undeclared suite timeouts are bounded at runtime by
min(per-suite budget, remaining per-job budget); when the per-job
wall-clock budget is exhausted, remaining suites are reported
`SKIPPED_BUDGET` and never run.

## Pin verification

The runner resolves the checkout's HEAD with `git rev-parse HEAD` and
REFUSES (`REFUSED` / `HEAD_MISMATCH`) unless it equals the job pin
exactly. Nothing executes on a mismatch — proven by a marker-file
sentinel in `tests/head-pin.test.js`. A GO at head X never blesses
head Y.

## Execution & classification

Suites run sequentially, each as a real child process in its own
process group, with a per-suite timeout kill (SIGTERM, then SIGKILL of
the whole tree) and a captured-output byte cap. If vitest is not
resolvable in the target (`node_modules/.bin/vitest` missing), the
suite is `ERROR` / `VITEST_NOT_RESOLVABLE` — never silently skipped or
passed, and npx is never allowed to fetch it from the network.

Per-suite status: `PASS` (exit 0 **and** parsed report with
`success === true`, zero failed tests, zero failed suites), `FAIL`
(failed tests, listed by name + file path), `ERROR` (suite load error,
unparseable/missing JSON, spawn failure, output cap), `TIMEOUT`,
`SKIPPED_BUDGET`. Missing or unparseable vitest output is always
`ERROR` — never a pass.

## Report (output)

Deterministic JSON: canonical key ordering, no timestamps and no
wall-clock durations in the body, so the same job on the same head with
the same outcomes is byte-identical across runs. Fields: job pin,
checkout head, per-suite status/counts/failing tests, totals, and the
advisory verdict — `ALL_SUITES_PASS` only when every suite ran and
passed. A Markdown renderer (`reportToMarkdown`) renders the same
report without inventing claims.

## CLI

```bash
node runner/run-job.mjs <job.json> [--out <report.json>] [--markdown-out <report.md>]
# canonical JSON to stdout; exit 0 only on ALL_SUITES_PASS, 1 otherwise, 2 on usage/IO errors
```

## Tests

```bash
node --test tests/*.test.js    # 43 tests, no deps beyond node
```

- `validation.test.js` — strict schema (unknown fields, bad pins,
  duplicate ids, flag-shaped patterns, shell-command refusal).
- `budget.test.js` — charge-before-validate, incl. past-the-limit
  sentinels dying on `BUDGET_EXCEEDED`, plus a run-level proof that an
  over-budget job executes nothing.
- `head-pin.test.js` — `HEAD_MISMATCH` / `TARGET_NOT_FOUND` /
  `HEAD_UNRESOLVABLE` refusals; the mismatch sentinel proves nothing
  executed (marker file absent).
- `classify.test.js` — exact classification from recorded vitest JSON
  fixtures (`fixtures/vitest-{pass,fail,error}.json`), incl.
  failing-test name/file extraction and deterministic sorting.
- `integration.test.js` — end-to-end runs against a temp git fixture
  checkout whose `node_modules/.bin/vitest` is a shell stub emitting
  recorded JSON with a chosen exit code. This exercises the runner's
  real process plumbing (spawn of `npx vitest run ...`, timeout kill,
  output file outside the target, parsing, CLI exit codes); only
  vitest itself is stubbed. The real-vitest proof is the live smoke
  below.
- `markdown.test.js` — renderer smoke + the pass-verdict gate.

## Live smoke (2026-10-22)

The runner CLI was run against the `marketplace409-designer-stack3`
checkout READ-ONLY at its HEAD `52b786ae9cd3386f9d5306f6b57da91f8ca1f941`,
one real suite (`src/app/api/capture/config/route.test.js`). The
emitted report is saved alongside this slice's evidence as
`qa-test-runner-smoke-2026-10-22.json` in the workspace root. Running
the suite writes only vitest's cache under the target's `node_modules`;
no tracked file in the target tree changes (verified by `git status`
before/after).

## Limitations (explicit non-goals)

- Slice 1 of the runner: panel-flow integration (verdict-watch /
  merge-guard consuming this report) is a separate slice.
- The target checkout must already have dependencies installed; the
  runner installs nothing and uses no network.
- Vitest only. Other test stacks are out of scope for this slice.
