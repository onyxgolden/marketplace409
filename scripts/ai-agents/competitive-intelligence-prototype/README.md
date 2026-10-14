# Competitive Intelligence Prototype — Phase 2 real-competitor core

Internal research agent core per `commands/muse/competitive-intelligence-agent-phase2-real-competitor-contract-2026-10-12.md`.

## What this is

A deterministic, read-only comparison core plus trial-lifecycle machinery:

- **Tri-state cells** (`src/cells.js`): every feature proposition is
  `supported` / `contradicted` / `unsupported` with citations. Absence of
  mention is never scored. Embedded instructions in evidence are quarantined.
- **Rubric** (`src/rubric.js`): `ahead` / `parity` / `behind` /
  `undetermined` / `not_comparable`. Ahead/behind requires cited explicit
  difference evidence. No whole-product winner, ever.
- **Comparison core** (`src/compare.js`): deterministic pipeline —
  validate input, evaluate, score, gate. Bounded (512 cells, 1 MiB output).
- **Trial ledger** (`src/ledger.js`): append-only state machine
  PLANNED → … → CLOSED. One trial per service. CLOSED requires evidenced
  cancellation. No secrets in the ledger.
- **Serial interlock** (`src/interlock.js`): one active evaluation at a time,
  generation-fenced. A lost heartbeat never frees a slot.
- **Card registry** (`src/card.js`): exactly one reusable prepaid card, $50
  aggregate ceiling (never resets). Attachment refuses without Jason's
  issuance approval. Reassignment requires evidenced cancellation first.
- **Challenge classifier** (`src/challenges.js`): email/checkbox/image-solver
  allowed once each; phone/SMS and payment/fraud always refused; no retry loops.
- **FORGE inventory** (`src/inventory.js`): repo pinning and code-evidence
  helpers. Not-found is `unknown`, never verified-absent.
- **Publisher** (`src/publish.js`): internal-only matrix/memo/receipt
  rendering with a no-copy gate.

## What this is NOT

- No network access, no web retrieval, no credentials, no model calls.
- No scheduler, no sandbox controller, no host adapters — those are
  separately permissioned components outside this core.
- No public output: everything is `internal_only`.

## Run tests

```
npm test   # node --test, 82 tests
```

## Contract authority

Confirmed competitor set: `results/muse/ci-confirmed-set-2026-10-13.json`.
Rental lane first: Rentec Direct (PM), Yardi Breeze, AppFolio, Buildium.
Card issuance NOT yet approved — card paths refuse until Jason approves.
