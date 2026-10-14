# Competitive Intelligence Prototype — Phase 2 real-competitor core

Internal research agent core per `commands/muse/competitive-intelligence-agent-phase2-real-competitor-contract-2026-10-12.md`.
Review fixes for ChatGPT PR #623 NEEDS CHANGES (CI-001..CI-006) are implemented
in this tree; see "Trust model" below.

## What this is

A deterministic, read-only comparison core plus trial-lifecycle machinery:

- **Tri-state cells** (`src/cells.js`): every feature proposition is
  `supported` / `contradicted` / `unsupported` with citations. Absence of
  mention is never scored. Embedded instructions in evidence are quarantined
  AND excluded from support/opposition. Same-scope conflicts preserve both
  sides' citations; out-of-scope evidence is recorded, not scored.
- **Rubric** (`src/rubric.js`): `ahead` / `parity` / `behind` /
  `undetermined` / `not_comparable`. Ahead/behind requires cited explicit
  difference evidence grounded in admitted sources. Stale/unverified freshness
  and missing scopes can never drive a score. No whole-product winner, ever.
- **Comparison core** (`src/compare.js`): validate input, admit against the
  trusted context, score from one canonical cell representation, gate.
  Bounded (512 cells, 1 MiB UTF-8 output); raw bounds enforced before traversal.
- **Trial ledger** (`src/ledger.js`): append-only state machine
  PLANNED → … → CLOSED over a host-held durable store (restart-safe, no
  double reservation). Pre-account BLOCKED is a clean skip; post-account
  blocks are BLOCKED_UNRESOLVED and keep obligations until bound
  cancellation/cleanup evidence resolves them. Trial/service identity immutable.
- **Serial interlock** (`src/interlock.js`): one active evaluation at a time,
  generation-fenced. Release consumes trusted ledger/card closure records
  bound to the lease — a caller status string is never proof.
- **Card registry** (`src/card.js`): exactly one reusable prepaid card, $50
  aggregate ceiling (never resets). Attachment requires a Jason issuance
  approval REGISTERED in the host's issuance store (truthiness is not
  approval) plus the live interlock lease. Strict cent semantics, no double
  counting; no FREE while holds/cleanup are outstanding. Durable snapshots.
- **Challenge classifier** (`src/challenges.js`): permitted handlers require a
  trusted own-trial-signup workflow registration; prohibited payment/fraud/phone
  purpose wins over image/checkbox wording; attempts counted from durable
  host-held history, never caller counters.
- **Trust + corpus** (`src/trust.js`, `corpus/`): host-injected admission
  context (confirmed set, admitted sources, verified FORGE snapshot, fixed
  clock) and frozen corpus authentication. `corpus/freeze.js` regenerates the
  manifest; the root digest is embedded in `src/trust.js` (the trust anchor).
- **FORGE inventory** (`src/inventory.js`): repo pinning and code-evidence
  helpers. Not-found is `unknown`, never verified-absent.
- **Publisher** (`src/publish.js`): internal-only matrix/memo/receipt
  rendering with a no-copy gate.

## Trust model

Nothing is self-attested. `runComparison(input, cells, trusted)` refuses
without a valid trusted context. Subjects must be confirmed, the FORGE pin
must exactly match the host-verified snapshot, every citation must resolve in
the admitted source store (unresolvable → cell becomes unsupported), and the
taxonomy digest must match the code. Quarantined, stale, unscoped, and
unregistered evidence can never drive parity/ahead/behind.

## What this is NOT

- No network access, no web retrieval, no credentials, no model calls.
- No scheduler, no sandbox controller, no host adapters — those are
  separately permissioned components outside this core.
- No public output: everything is `internal_only`.

## Run tests

```
npm test   # node --test, 148 tests (82 original + 66 new/updated)
node runner/run-manual.js   # corpus-authenticated smoke run
```

After ANY corpus change (src minus trust.js, tests, runner): re-run
`node corpus/freeze.js`, embed the printed digest in `src/trust.js`, re-run tests.

## Contract authority

Confirmed competitor set: `results/muse/ci-confirmed-set-2026-10-13.json`.
Rental lane first: Rentec Direct (PM), Yardi Breeze, AppFolio, Buildium.
Card issuance NOT yet approved — card paths refuse until Jason approves.
Base: onyxgolden/marketplace409@ec99508. Provenance: contract path,
confirmed-set path, and reviewed heads are recorded in the PR, not here.
