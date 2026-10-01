# Slice 10 — Doc-drift self-repair (design)

## Purpose

The code self-heal loop is closed (Slices 1–9): evidence → diagnose →
propose → apply+verify → fix PR → nightly runner. The other half of Jason's
goal — "FORGE Brain updating all documents without human help" — is unbuilt:
docs rot when code moves (renamed scripts, moved files, relocated design
docs), and nothing notices. Slice 10 gives the brain deterministic doc-drift
detection plus narrow, section-scoped rewrites that travel through the
already-reviewed Slice 7 fix-PR pipeline. Review and merge stay human, exactly
like code fixes.

## What it is

- `scripts/engineering-brain/docs/detectDocDrift.mjs` — detection only.
  Scans `docs/**/*.md` for three drift classes (all fail-closed, no edits):
  - D1 `doc-dead-path-literal`: a backtick-quoted repo-relative path that no
    longer exists (globs resolved with the Slice 3 `pathExistsInRepo` rule).
    Literals starting with `./` or `../` resolve against the doc's own
    directory first (the docs convention); a bare `./name` with no
    subdirectory is skipped — it is almost always an import-specifier
    example in prose, not a path claim. Existence is checked case-exact
    first, then case-insensitive (the evidence matcher lowercases; doc
    authors usually write exact case).
  - D2 `doc-dead-script-ref`: `` npm run <name> `` where `<name>` is not a
    `package.json` script.
  - D3 `doc-dead-doc-link`: a relative `[text](target)` link whose `.md`
    target does not resolve (anchors stripped first).
  - Findings: `{ driftClass, docPath, line, literal }`, deterministic order.
- `scripts/engineering-brain/docs/proposeDocFix.mjs` — one finding in, one
  patch out (or an honest `noPatch`). Reuses the Slice 2/3 seam library
  verbatim: `findUniqueMatch` (unique tier-1 close match) for D1/D3,
  `uniqueCloseMatch` (levenshtein 1..2, same first char) for D2,
  `buildReplacement`, `diffHunks`, `renderUnifiedDiff`.
  - The rewrite is scoped to the finding's enclosing ATX section: the same
    dead literal in another section is left alone.
  - D3 re-relativizes the matched doc to the doc's directory and preserves
    any `#anchor`.
  - Output patch shape matches `prepareFixPr` (`repairClass`, `path`,
    `original`, `patched`, `unifiedDiff`), so the Slice 7 pipeline accepts
    doc patches unchanged.
- `scripts/engineering-brain/docs/runDocDriftCli.mjs` — CLI.
  `npm run forge:docs:drift -- --repo <root> [--docs <dir>...] [--apply]
  [--max-fixes <n>] [--base <sha>] [--dry-run] [--json]`
  - Read-only report by default (findings are not failures; exit 0).
  - `--apply` sends up to `--max-fixes` (default 1) proposable patches
    through `prepareFixPr` with a doc-aware `applyAndVerify`: fresh worktree
    at `--base`, staleness check vs `patch.original`, markdown sanity
    (non-empty, backtick parity, docs-only target). `applyPatch` (Slice 5)
    is code-only and stays untouched — it fail-closes on unknown repair
    classes by design.
- `package.json` — `forge:docs:drift` script.

## Safety rails (mirroring the code classes)

- Docs only: target must be a `.md` file under `docs/`; manifests, code,
  workflows, and anything outside `docs/` are never rewrite targets.
- One file, one hunk, max 20 changed lines; ambiguous or missing matches →
  `noPatch`, never a guess.
- No model calls. No auto-merge — PRs land as `engbrain-fix/*` branches for
  human review, in the same suppression family as code fixes (a prior fix PR
  for the same drift suppresses retries via the existing nightly dedupe).
- Nightly scheduling is out of scope (Slice 11): Slice 10 is scan + propose +
  on-demand `--apply`.

## Tests (hermetic)

- D1/D2/D3 detection: dead refs flagged; live refs not flagged; URL /
  absolute-path / bare-word literals ignored; link anchors stripped.
- Rewrite: dead path fixed within its section only (identical literal in a
  sibling section untouched); dead script ref fixed; dead doc link
  re-relativized with anchor preserved.
- `noPatch` on: ambiguous matches, no close match, non-doc target, literal
  absent from section, unknown drift class.
- `sectionBounds`: enclosing section, preamble, nested subsections.
- CLI arg parsing: `--dry-run` refuses `--apply`; `--apply` requires
  `--base`; `--max-fixes` must be a positive int.

## Boundaries (unchanged)

- The proposer never applies, commits, pushes, merges, or deploys.
- Only mutating actions are branch push + PR creation via Slice 7.
- PR bodies carry provenance (drift class, doc, line) — no doc content
  beyond the diff itself.
