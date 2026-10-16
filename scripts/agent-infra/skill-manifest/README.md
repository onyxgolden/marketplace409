# Portable skill manifests — packaging linter (slice 1)

Read-only inventory and packaging linter for FORGE engineering playbooks,
plus a portable frontmatter template. Reuses the open Agent Skills format
(https://agentskills.io/specification); the `forge:` block is a labeled
FORGE policy extension, not upstream.

## What it does

- `src/linter.mjs` — validates a skill directory's `SKILL.md` frontmatter
  (bounded YAML subset; tags never evaluated), checks link/portability
  hygiene, enforces 64-file / 256 KiB admission caps, and emits a
  deterministic JSON report. Never executes scripts, never touches the
  network, never rewrites the skill. Packaging conformance only — never a
  security approval.
- `src/inventory.mjs` — read-only inventory of installed playbooks.
- `frontmatter-template.yaml` — portable template (upstream fields +
  documented FORGE extensions).
- `fixtures/` — 24 frozen fixtures, each with an independent expected
  diagnostic list.
- `pilots/` — proposed (not applied) manifest diffs for the three pilot
  playbooks: review workflow, engineering handoff, offline artifact.
- `docs/` — detailed procedures: [frontmatter rules](docs/frontmatter-rules.md),
  [diagnostic catalog](docs/diagnostic-catalog.md),
  [Skill Spectre composition](docs/spectre-composition.md).

## Run

```sh
node src/linter.mjs <skill-root> [--spectre-findings findings.json]
node tests/run-tests.mjs
```

Exit codes: 0 conformant · 1 nonconformant/review_required · 2 operational error.

## Boundaries

- Unknown license becomes REVIEW_REQUIRED, never inferred permissive.
- Requested/allowed-tools metadata never grants actual tool permission.
- No new high/critical security block categories; security composes through
  Skill Spectre's PROMPT_INJECTION / SUPPLY_CHAIN / MALWARE findings.
- Skills containing operational data are excluded; fixtures are synthetic
  engineering examples only.
- No global skill installation or live workflow change. Proposed pilot diffs
  remain reviewable diffs.

## Existing-tooling inventory (per scope)

No equivalent linter exists in the repo or workspace tooling: Skill Spectre
is briefed (2026-10-12) but not implemented, so there is no scanner to extend
— its three threat classes are reserved as a composition slot instead. The
custom-skills directories have no packaging validation. This slice builds the
new linter rather than extending anything.
