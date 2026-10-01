# Slice 11 — Nightly doc-drift wiring

## What it is

Slice 10 gave the brain doc-drift scan + propose + on-demand `--apply`.
Slice 11 puts it on a schedule: every night the brain scans `docs/` for
drift and opens fix PRs for what it can deterministically repair — the docs
half of Jason's goal ("FORGE Brain updating all documents without human
help") running on its own. It mirrors the Slice 9 nightly self-heal runner
exactly: same budget, same dedupe, same fail-closed posture, same human
review/merge boundary.

## Files

- `scripts/engineering-brain/docs/runNightlyDocDrift.mjs` — the nightly
  driver. `runNightlyDocDrift({ repoRoot, docs, baseCommit, maxFixes = 3,
  driftId, dryRun, deps })`.
- `scripts/engineering-brain/docs/runNightlyDocDriftCli.mjs` — CLI wrapper
  (`npm run forge:docs:drift:nightly`).
- `.github/workflows/engineering-brain-doc-drift-nightly.yml` — one DST-aware
  01:00 America/Chicago execution per day: a single cron entry fires at both
  candidate UTC slots (06:00/07:00 UTC — 1:00 AM Chicago is 06:00 UTC in CDT,
  07:00 UTC in CST) and a schedule-guard step no-ops the slot whose Chicago
  local hour is not 01. Manual dispatch always runs. Checkout follows the
  triggering ref (scheduled runs resolve to main); `npm ci`, run the CLI with
  `--github-actions`, upload the JSON report as an artifact.
- `scripts/engineering-brain/docs/__tests__/runNightlyDocDrift.test.mjs`
- `package.json` — adds `forge:docs:drift:nightly`.

## Behavior

1. **Scan.** Uses the Slice 10 `scanAndPropose` seam (injected in tests).
   Findings come back deterministically ordered (doc path, then line); the
   driver re-sorts defensively so a custom seam cannot change
   night-to-night order.
2. **Drift identity.** `driftIdFor(finding)` =
   `doc-drift/<class>/<docPath>:<line>` — the same signalId the Slice 10
   CLI stamps into fix-PR titles. Dedupe reuses the Slice 9
   `findPriorFixPr` unchanged: branch prefix `engbrain-fix/` + title
   containing the drift id. A drift with any prior fix PR — open, merged,
   or human-closed — is never re-attempted.
3. **No-patch findings are skipped**, not attempted and not counted against
   the budget. They are reported as `no-patch` so the night's report shows
   what the brain saw and declined.
4. **Budget.** At most 3 fix PRs per night (`maxFixes`, default 3);
   everything beyond the budget is `deferred` with reason
   `max-fixes-reached` and retried the next night if still proposable.
5. **Each attempt** runs the reviewed Slice 7 `prepareFixPr` with the
   Slice 10 doc-aware `applyAndVerify` (fresh worktree at `--base`,
   staleness check, backtick parity, docs-only target). One finding in,
   at most one PR out.
6. **Fail-closed.** Unreadable repo, scan throw, or fix-PR-listing throw
   fails the run. A driver that *throws* (clean stops return, never throw)
   is recorded, remaining findings still run, and the run reports `ok:false`.
7. **Never merges, never deploys, never writes production data.** The only
   mutations are fix-branch pushes and fix-PR creation through the reviewed
   pipeline, and only when `dryRun` is false.

## CLI

```
node scripts/engineering-brain/docs/runNightlyDocDriftCli.mjs \
  --repo <repoRoot> --base <commit> [--docs <dir> ...] \
  [--max-fixes <n>] [--drift-id <id>] [--github-actions] \
  [--dry-run] [--json]
```

Exit codes: 0 clean pass (findings are not failures), 1 runner failure,
2 bad usage. `--github-actions` swaps push/open/list to the GITHUB_TOKEN
adapters (`makeGithubActionsDeps`, Slice 9) — the workflow runs with the
automatic `GITHUB_TOKEN` (contents: write, pull-requests: write).

## Tests (hermetic)

- Deterministic drift-id order across a scrambled report.
- Budget cap + deferral; no-patch findings skip without consuming budget.
- Dedupe: prior open → `already-open`, merged → `already-merged`,
  closed → `already-closed`; unrelated PRs don't match.
- `drift-id` filter: single targeted run; unknown id fails clean.
- `dry-run`: `would-attempt`, no driver calls.
- Driver throw recorded, run continues, `ok:false`; clean stops stay clean.
- Fail-closed on scan throw and fix-PR-listing throw.
- Arg validation: missing context, malformed base SHA, bad maxFixes.
- CLI arg parsing: multi-value `--docs`, defaults, flags.

## Boundaries (unchanged)

- No model calls. No auto-merge. No deployment. No production writes.
- Only `.md` files under `docs/` are ever rewritten (Slice 10 gate).
- The workflow file lands via the GitHub web UI (the API token lacks the
  workflow scope) — never silently omitted.
