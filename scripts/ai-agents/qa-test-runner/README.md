# QA agent — Slice 2 (P3): the pre-merge test-runner

Runs named vitest suites on an **exact pinned HEAD** inside a checkout
the operator names, and emits a deterministic advisory report for the
panel flow. **Advisory only: it merges nothing, approves nothing, and
carries no authority.** It never checks out, fetches, pushes, or writes
into the target tree.

Sibling of `qa-inspection-prototype/` (slice 1, untouched by this
slice). Implements brief
`commands/muse/qa-test-runner-slice1-brief-2026-10-22.md` in the
`onyxgolden/forge-ai-drop` coordination repo. The isolation/pin-binding
semantics below are the fix round for ChatGPT's Q665-001..007 verdict
on PR #665 (NEEDS CHANGES at `bd8ed711`).

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
    "max_captured_bytes_per_suite": 1048576,
    "max_reporter_bytes_per_suite": 1048576,
    "max_report_bytes": 4194304
  }
}
```

Strict validation: unknown properties are refused everywhere, duplicate
suite ids are refused, the pin must be full 40-hex lowercase, and a
suite carries **only** an id + test-path patterns (+ optional timeout) —
free-form shell commands are refused structurally; argv is constructed
by the runner (`npx vitest run <patterns> --reporter=json
--outputFile <scratch file outside the target tree>`), never taken from
the job. Patterns starting with `-` are refused (flag injection).

## Admission — charge before inspect

Before validation, the job value passes **admission** (`src/admit.js`):
a descriptor-only walk (getters/Proxies are refused from their
descriptors, never invoked) under depth (32), node (4096) and byte
(64 KiB) limits, producing a detached plain-data copy. Validation,
budget charging and refusal-building operate only on that copy, and
refusals are built from admitted metadata only — capped suite lists,
truncated strings — so a refusal can never become an unbounded
serialization of a rejected tail. The CLI checks the job file's size
before reading it and reads at most the limit.

## Budgets — charged before execution

Every budget is charged **before** anything runs, walking the suites in
job order and charging each candidate (suite slot, pattern slots,
declared timeout) **before** that candidate's fields are validated. An
entry sitting past a limit therefore dies on `BUDGET_EXCEEDED` — never
on a validation error for its unexamined contents, and never by
running. Sentinel-proven in `tests/budget.test.js` and
`tests/fix-round.test.js`. Hard caps: 16 suites, 32 patterns/suite,
120 s per suite, 600 s per job, 8 MiB captured stdout/stderr per suite,
8 MiB reporter file per suite, 16 MiB serialized report; a job may
tighten budgets, never loosen them. Undeclared suite timeouts are
bounded at runtime by min(per-suite budget, remaining per-job budget);
when the per-job wall-clock budget is exhausted, remaining suites are
reported `SKIPPED_BUDGET` and never run. Kill grace/cleanup time is
real wall-clock and is charged to the job budget as it elapses.

Two byte budgets, kept distinct on purpose:

- `max_captured_bytes_per_suite` — the suite process's stdout/stderr
  stream, counted live; exceeding it kills the suite
  (`OUTPUT_CAP_EXCEEDED`).
- `max_reporter_bytes_per_suite` — the vitest JSON reporter **file**,
  the suite's main evidence payload. Its size is checked with `stat`
  BEFORE the file is read or parsed; exactly-at admits, +1 refuses
  with `REPORTER_CAP_EXCEEDED`. Extracted failing-test records are
  additionally bounded (100 entries, truncated fields, true total +
  truncation flag reported).
- `max_report_bytes` — the serialized **final report envelope**,
  enforced CENTRALLY by `runJob` for every API outcome (completed,
  refused, error) via `report-bounds.js` — not just at CLI
  serialization. Exact-fit passes through byte-identical; +1 over
  truncates to a deterministic envelope that preserves the outcome
  (status/verdict/reason_code) and marks `REPORT_TRUNCATED`.
  Admission requires `max_report_bytes >= 1024`: a smaller cap cannot
  fit any envelope, so the job is refused (`INVALID_BUDGET`) instead
  of producing an unbounded or content-free report.

## Pin binding — the evidence is about the pin's bytes

HEAD equality alone does not prove a checkout matches its pin, so:

1. The checkout's HEAD must equal the pin exactly (`HEAD_MISMATCH`).
2. The working tree must be **clean** — no modified, staged or
   untracked files (`TARGET_NOT_CLEAN`). The operator's checkout is
   never modified, cleaned or stashed by the runner.
3. The execution tree is **materialized from the pinned commit
   object** (`git archive <pin>`) into a disposable scratch directory.
   The suites execute those bytes — a file changed after the pin
   cannot ride along, and a change between preflight and execution
   has nothing to act on. The checkout's installed `node_modules` is
   copied into the disposable tree (dependencies are environment, not
   evidence content; the suites' source all comes from the pin).
4. After the run, HEAD + working-tree status are re-read and compared
   to the pre-run snapshot. Any change voids the blessing:
   `CHECKOUT_CHANGED_DURING_RUN`, verdict forced to `SUITES_FAILED`.

## Isolation — declared, enforced, or refused

Suites execute inside an isolation boundary (`src/isolation.js`), and
the report states the mechanism it used:

- **Network denied** by a network namespace (connects fail
  `ENETUNREACH` — there are no routes, not just a polite env var).
- **Environment scrubbed** to an allowlist (`PATH`, `LANG`, `LC_ALL`);
  `HOME`/`TMPDIR` point into the job scratch dir, so npx/vite caches
  land in disposable space. No operator credentials are inherited.
- **Descendants contained** by a pid namespace: when the boundary
  process dies, the kernel destroys every process in the namespace.
- With **bubblewrap** (`bwrap`, preferred), the filesystem is also
  read-only except the scratch dir — writes elsewhere fail `EROFS`.
  Fallback: **util-linux unshare** (user/net/pid/mount namespaces; the
  operator checkout is additionally bind-mounted read-only over
  itself inside the namespace).
- If the host offers **neither** mechanism, the job is `REFUSED` /
  `ISOLATION_UNAVAILABLE`. The boundary is never silently claimed.
  Supported hosts: Linux with bubblewrap or util-linux unshare.

Timeouts are enforced by a **supervisor deadline**, not by pipe close:
at the deadline the boundary gets SIGTERM, after a 2 s grace SIGKILL,
and the suite settles after a liveness verify — whether or not an
escaped descendant is still holding the inherited output pipes open
(the namespace collapse kills it regardless). The absolute settle
bound is `timeout + 3.25 s`; if the boundary cannot be confirmed dead,
the suite is `ERROR` / `CLEANUP_FAILED`, never a healthy receipt.

## Classification — derived counts, reconciled headers

Counts are **derived from the assertion/file records**, never copied
from the vitest header. Header totals are cross-checked against the
derived values:

- any observed failed assertion or failed file precludes `PASS`,
  whatever the header says;
- a header that disagrees with the records, or `success` contradicting
  the records, is `ERROR` / `INCONSISTENT_REPORT`;
- malformed reporter structure is `ERROR` / `MALFORMED_REPORT`, and
  classification is total — no report shape can throw;
- a consistent failing report is `FAIL` with failing tests by name +
  file; failed files with no failed assertions are
  `ERROR` / `SUITE_LOAD_ERROR`.

Per-suite status: `PASS`, `FAIL`, `ERROR` (load error, unparseable or
malformed or inconsistent report, spawn failure, output/reporter cap,
cleanup failure, vitest not resolvable), `TIMEOUT`, `SKIPPED_BUDGET`.
Missing or unparseable vitest output is always `ERROR` — never a pass.

## Report (output)

Deterministic JSON: canonical key ordering, no timestamps and no
wall-clock durations in the body, so the same job on the same head with
the same outcomes is byte-identical across runs. Fields: job pin,
checkout head, the `isolation` record (mechanism + policy), per-suite
status/counts/failing tests (+ totals and truncation flags), totals,
and the advisory verdict — `ALL_SUITES_PASS` only when every suite ran
and passed. A Markdown renderer (`reportToMarkdown`) renders the same
report without inventing claims.

## CLI

```bash
node runner/run-job.mjs <job.json> [--out <report.json>] [--markdown-out <report.md>]
# canonical JSON to stdout; exit 0 only on ALL_SUITES_PASS, 1 otherwise,
# 2 on usage/IO/output errors
```

Stdout is an awaited, drained write with the exit status staged via
`process.exitCode` — the canonical JSON is never truncated on a pipe,
however large the report. `--out` / `--markdown-out` may not name a
path inside the target checkout (containment: exit 2, nothing
written); write failures are explicit on stderr with exit 2.

## Tests

```bash
node --test tests/*.test.js    # 68 tests, no deps beyond node
```

- `validation.test.js` — strict schema (unknown fields, bad pins,
  duplicate ids, flag-shaped patterns, shell-command refusal).
- `budget.test.js` — charge-before-validate, incl. past-the-limit
  sentinels dying on `BUDGET_EXCEEDED`, plus a run-level proof that an
  over-budget job executes nothing.
- `head-pin.test.js` — `HEAD_MISMATCH` / `TARGET_NOT_FOUND` /
  `HEAD_UNRESOLVABLE` refusals execute nothing.
- `classify.test.js` — exact classification from recorded vitest JSON
  fixtures (`fixtures/vitest-{pass,fail,error}.json`), incl.
  failing-test name/file extraction and deterministic sorting.
- `integration.test.js` — end-to-end runs against a temp git fixture
  checkout whose `node_modules/.bin/vitest` is a shell stub emitting
  recorded JSON. Exercises the runner's real process plumbing under
  the isolation boundary; the stub's writes land in the disposable
  copy, never the fixture checkout.
- `fix-round.test.js` — the Q665-001..007 regression probes: dirty /
  staged / untracked refusal without cleaning, mid-run mutation,
  write-attempt + network-denial + env-scrub probe, contradictory and
  malformed reports, deep-nesting / getter / Proxy admission,
  reporter exact/+1 budgets, escaped-descendant timeout with
  heartbeat evidence, output-cap settlement, piped-CLI completeness,
  CLI input cap exact/+1 and `--out` containment.
- `fix-round3.test.js` — the Q665-002A/002B/003A/003B round-3 probes:
  symlinked node_modules refusal with no host-side write, canonical
  (dangling-link-aware) `--out` containment incl. ancestor aliases,
  fake-bwrap capability detection, closed reporter/status schemas,
  the frozen real vitest 4.1.9 todo/skip/pass fixture plus partner
  variants.
- `fix-round3b.test.js` — the Q665-004A/004B/005A round-3 probes:
  `__proto__` dangerous-key refusal (verbatim vector, nested,
  over-budget), exact incremental UTF-8 byte charging (exact-fit/+1
  through API and CLI, multibyte-exact, charge-before-visit
  sentinel), and the central final-envelope bound (exact/+1,
  long-diagnostic truncation, admission floor, API end-to-end).
- `markdown.test.js` — renderer smoke + the pass-verdict gate.

## Limitations (explicit non-goals)

- Slice 1 of the runner: panel-flow integration (verdict-watch /
  merge-guard consuming this report) is a separate slice.
- The target checkout must already have dependencies installed; the
  runner installs nothing and uses no network.
- Vitest only. Other test stacks are out of scope for this slice.
- Linux hosts with bubblewrap or util-linux unshare only; other hosts
  get an explicit `ISOLATION_UNAVAILABLE` refusal.
