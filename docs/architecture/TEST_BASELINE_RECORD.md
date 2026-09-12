# Test Baseline Record — 2026-09-11 Regression Cleanup

## Status

**Closed.** The previously repeated "20 pre-existing test failures" exception is retired as of this record. Future sessions must not cite it, reintroduce it, or treat any new regression-suite failure as pre-existing without independently reproducing and documenting it the way this record does.

## What was repeatedly claimed

Multiple prior sessions accepted a full regression run with a standing exception described as "9 files / 20 tests" pre-existing, known-failing, and safe to ignore.

## What a clean, locked baseline actually showed

A clean isolated git worktree was created directly from `origin/main` (`13bd5e77189f1a6e14adbd7638f850417183029a`, the PR #171 merge commit). Dependencies were installed with `npm ci` (the repository's locked installation method — `package-lock.json`, 666 packages, zero resolution drift). The complete regression command (`npx vitest run`) was then run once against this untouched baseline.

Actual result: **3 files failed, not 9. 20 tests failed, not spread across 9 files.**

| Test file | Failing tests | Reproduces alone | Reproduces only in full suite |
| --- | --- | --- | --- |
| `src/infrastructure/developer/executeProgrammerCommand.test.js` | 18 | Yes | No |
| `scripts/governance/__tests__/validateGovernanceArchitecture.test.mjs` | 1 | Yes | No |
| `scripts/governance/__tests__/validateGovernanceRelationships.test.mjs` | 1 | Yes | No |

All 20 failures shared one root cause (below). None were flaky, order-dependent, or full-suite-only. The "9 files" figure in the repeatedly-cited baseline does not match a clean, locked-install run and should not be relied on again.

## Shared root cause

`governance/validation/` is a required, permanent governance location:

- `findLatestValidationEvidence()` (`src/infrastructure/developer/executeProgrammerCommand.js`) requires the directory to exist before it will look for evidence files inside it.
- `scripts/governance/validateGovernanceArchitecture.mjs` lists `governance/validation` in `REQUIRED_GOVERNANCE_DIRECTORIES`.
- `scripts/governance/validateGovernanceRelationships.mjs` requires it to exist as the canonical-owner path for the `repository-evidence` governance node.

`.gitignore` correctly excludes the *generated evidence files* inside that directory (`/governance/validation/*.json`, `/governance/validation/*.tmp`), but nothing kept the *directory itself* tracked in git. A clean checkout (any fresh clone, worktree, or CI runner) therefore never has `governance/validation/` on disk at all — only a developer's own machine, after having manually run `generate-validation-evidence` at some point, would happen to have it. Tests and CLIs that depended on that directory existing were unknowingly depending on generated, gitignored, developer-machine-only state.

## Fixes applied

1. **`governance/validation/.gitkeep`** (new, tracked) — keeps the directory itself present in every checkout, exactly like the repository's existing convention for other required-but-otherwise-empty directories (`src/domains/.gitkeep`, `src/services/.gitkeep`, etc.). This is an empty placeholder, not evidence: `findLatestValidationEvidence()` still correctly throws `"No validation evidence artifact is available."` when no real generated evidence file is present — the fail-closed production behavior for absent evidence is unchanged and was verified directly against the real repository after this fix.
2. **`src/infrastructure/developer/executeProgrammerCommand.test.js`** — the 18 failing tests all invoked `executeProgrammerCommand` with `repositoryRoot: process.cwd()` for the `prepare-next-session` / `complete-session-closeout` commands, which resolve validation evidence through `findLatestValidationEvidence()` — a real `fs` call, not one of the function's injectable dependencies (unlike `listSnapshotNamesFn`, `readSyncedGovernanceStateFn`, `readSnapshotFn`, which those same tests already inject as mocks). Fixed by adding `createRepositoryRootWithEligibleValidationEvidence()`, a fixture builder that creates an isolated `fs.mkdtempSync` temporary repository root per test, containing a `.git` marker (the only thing `executeProgrammerCommand` checks — it never reads real Git state) and one realistically-shaped `governance/validation/forge-validation-<timestamp>.json` evidence artifact (schema-, category-, and commit-shaped exactly like the real evidence format used elsewhere in `scripts/governance/`). Every temp root is tracked and removed in `afterEach`. No test's assertions were weakened, skipped, or deleted; none of the 18 tests exercise evidence-selection edge cases themselves (that is `selectEligibleValidationEvidence.test.mjs`'s job, and it already passed before and after this change) — they all needed the same "evidence lookup succeeds" precondition to reach the behavior they actually test.

### A second-order regression caught during verification

Adding the tracked `.gitkeep` surfaced a latent bug in a third file, **`scripts/governance/__tests__/runShadowGovernancePipeline.test.mjs`**, on the first attempted full-suite re-run (it does not reproduce when the file is run alone against the pre-fix baseline — only after `.gitkeep` exists, confirmed by reproducing against a stashed pre-fix tree). That test builds a disposable Git repository by copying the real `governance/` directory tree (which now includes the tracked `.gitkeep`), committing it, then wiping and recreating `governance/validation/` with a fixture-bound evidence artifact before writing it — `fs.rmSync(validationDirectory, { recursive: true, force: true })` deleted the just-committed `.gitkeep` from the working tree without restoring it, leaving Git correctly reporting an uncommitted deletion. The real `selectEligibleValidationEvidence.mjs` dirty-tree guard then correctly rejected the fixture's evidence as ineligible — production code behaving exactly as intended, exposing a fixture that implicitly assumed `governance/validation/` had nothing in it to begin with. Fixed by having the fixture note whether `.gitkeep` existed before the wipe and restoring it byte-for-byte afterward, so the working tree matches `HEAD` exactly, same as before the directory was touched. No production logic (including the dirty-tree guard itself) was changed or weakened.

## Independently reconfirmed: scheduling Excel / `exceljs` is not currently broken

Earlier session summaries had flagged a possible scheduling Excel import/export / `exceljs` dependency problem. Re-investigated from scratch against this same clean, locked install:

- `exceljs@4.4.0` — exactly the version pinned in `package.json` (`^4.4.0`) and resolved in `package-lock.json`; `npm ci` installs it without drift.
- `src/domains/scheduling/schedulingExcelImport.test.js`, `src/domains/scheduling/schedulingExcelExport.test.js`, `src/app/api/forge/scheduling/[projectId]/import/excel/route.test.js`, `src/app/api/forge/scheduling/[projectId]/export/excel/route.test.js` — 26/26 tests pass.

This did not reproduce. It was not part of the 20-test baseline and required no fix. Nothing about workbook validation was mocked away or weakened to reach this result — these are the same real `exceljs` workbook-construction/parsing tests that existed before this cleanup.

## Final regression result

After all fixes, the complete regression command (`npx vitest run`) was re-run from the same worktree, alone (no other process running concurrently, after an earlier concurrent `tsc` run caused one unrelated transient timeout flake in `buildSessionCloseoutProposal.test.mjs` that did not reproduce in isolation and required no fix):

- Test Files: **1011 passed (1011)**
- Tests: **7350 passed, 1 skipped (7351), 0 failed**
- The 1 skipped test is a pre-existing, environment-gated skip (present identically in the very first clean-baseline run captured above, before any fix) — not introduced or affected by this cleanup.

Lint (scoped to the three changed files, since pre-existing repo-wide React Compiler/formatting warnings on unrelated files are out of scope for this PR and were not touched): clean, zero findings. `npx tsc --noEmit`: clean, zero output. `git diff --check` against `origin/main`: clean.

## Rule going forward

No future session may cite "20 pre-existing failures," "9 known-failing files," or any variant of this exception again. If the regression suite fails, the failure is either fixed at its root cause or documented fresh, in the same evidentiary form as this record (exact file, exact test, exact error, shared root cause, alone-vs-full-suite reproduction) — never waved through as an old, already-accepted exception.
