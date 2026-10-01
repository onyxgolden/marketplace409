# Slice 9 — Nightly runner wiring (design)

## Purpose

Close the loop: the 5 AM scan collects `evidence.json`; the runner turns each
*new* usable signal into at most one driver run (`runSelfHeal`), which may open
at most one fix PR. Review and merge stay human (ChatGPT review + Jason).

## What it is

- `scripts/engineering-brain/patch/runNightlySelfHeal.mjs` — the runner.
  One function: `runNightlySelfHeal({ evidencePath, repoRoot, baseCommit,
  maxAttempts = 3, signalId = null, dryRun = false, deps = {} })`.
- `scripts/engineering-brain/patch/runNightlySelfHealCli.mjs` — CLI.
  `npm run forge:self-heal:nightly -- --evidence <json> --repo <root>
  --base <sha> [--signal <id>] [--max-attempts <n>] [--github-actions]
  [--dry-run] [--json]`
- `scripts/engineering-brain/patch/githubActionsDeps.mjs` — GITHUB_TOKEN
  push / open-PR / list-fix-PRs adapters for the Actions workflow.
  The driver's local defaults use this VM's credential surrogate and do not
  work on a GitHub runner; the seam is injectable, so the workflow passes
  Actions-flavored deps instead.
- `.github/workflows/engineering-brain-nightly-selfheal.yml` — triggers on
  `workflow_run` completion of the scan workflow (main branch only),
  downloads that run's `evidence.json` artifact, runs the CLI with
  `--github-actions`, uploads the report. Added via the web UI after the
  code PR is up (API token lacks the workflow scope).

## Flow

1. **validate** — evidence path, repo root, base SHA required; `--base` must
   look like a hex SHA; `--max-attempts` a positive int (default 3).
2. **load** — read evidence.json (fail-closed: missing file / bad JSON fails
   the run); `parseCollectedEvidence` (Slice 6) yields usable signals +
   warnings. Zero usable signals → clean exit, `no-usable-signals`.
3. **order** — signals sorted by `signal_id` (deterministic night to night).
   `--signal` restricts to one id (fail-closed on unknown).
4. **dedupe** — `listFixPrs()` (injectable) returns prior `engbrain-fix/*`
   PRs (any state). A signal whose id appears in a prior fix PR's title is
   skipped: `already-open`, `already-merged`, or `already-closed`. A
   human-closed PR is never re-attempted automatically.
5. **attempt** — up to `maxAttempts` signals per night (spam guard); the rest
   are reported `deferred`. Each attempt calls `runSelfHeal` with the
   caller's push/openPr deps. `--dry-run` stops before this step.
6. **report** — per-signal outcome `{ signalId, outcome, stage?, reason?,
   branch?, pr? }`; exit 0 unless the runner itself failed.

## Exit codes

- 0 — every attempted signal reached a clean stop (PR opened, noPatch,
  manual, validate refusal, already-open/merged/closed, deferred, or
  no-usable-signals). Clean stops are expected, not failures.
- 1 — runner failure: bad inputs, unreadable evidence, or a driver call
  *threw* (a clean stop never throws). A throw is recorded, remaining
  signals still run, and the run exits 1 at the end — loud, but one bad
  signal never blocks the night's other signals.
- 2 — bad CLI usage.

## Boundaries (unchanged from Slices 7/8)

- The runner never merges, never deploys, never writes production data.
- Its only mutating actions are branch push + PR creation, via the
  already-reviewed Slice 7 path.
- PR bodies carry provenance only (`signalId`, `failedStep`, `collectedAt`)
  — the Slice 7 summary-leak fix is untouched.
- No model calls; no batch healing beyond the per-night cap.
- The workflow only runs for scan completions on `main` (`head_branch`
  guard) — branch-dispatch evidence never triggers main healing.

## Tests (hermetic)

- Enumeration order is deterministic across signal insertion orders.
- `maxAttempts` caps attempts; the rest are `deferred`.
- Signals with a prior open / merged / closed fix PR are skipped and the
  driver is never called for them.
- Clean driver stops (noPatch, manual, fix-pr refusal) → exit 0, recorded.
- Driver throw → recorded, remaining signals still attempted, exit 1.
- Missing evidence file / bad JSON → fail-closed.
- `--dry-run` never calls the driver.
- CLI parsing: `--github-actions` requires `GITHUB_TOKEN` and
  `GITHUB_REPOSITORY`; bad `--max-attempts` → exit 2.
- Actions adapters build the right `git push` / `gh pr create` / `gh pr list`
  invocations against a fake exec (no network).
