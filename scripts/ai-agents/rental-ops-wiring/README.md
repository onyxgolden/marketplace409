# Rental-ops wiring — slice P2a-1 (Property Manager daily exception review)

Executable wiring for the AI Lab Property Manager agent: a bounded,
read-only source adapter, deterministic normalization into an
allowlisted snapshot, a guarded evaluator, an evidence-linked private
Workbench item, and decision-only review controls. Exercised end to
end with synthetic repositories and a running Workbench.

**Readiness: WIRED_INERT / SYNTHETIC_RUNTIME_VERIFIED / LIVE_NOT_AUTHORIZED.**
Both rental-ops jobs remain disabled. Nothing here is registered
with any cron, workflow, Bridge poller or scheduler; job descriptors
(`descriptors/job-descriptors.json`) are data. The Maintenance
Manager job (P2a-2) is not built in this slice and refuses with
`JOB_NOT_BUILT_IN_SLICE`.

## Layout

- `src/runner.js` — the inert runner. Host-owned config (mode,
  adapter kind, registered principal/owner) decides what may run; the
  job request is data and cannot carry a mode, adapter, URL, path or
  SQL. Evaluation runs in a pinned worker (`src/evaluateWorker.js`)
  under a hard 5-second boundary.
- `src/syntheticRepository.js` — the only installed adapter:
  in-memory, owner-scoped, paged, with declarative fault injection
  for tests. No credentials, network, SQL or filesystem.
- `fixtures/repositories.js` — named synthetic repositories (closed
  registry) with PII canaries planted outside the field allowlist.
- `runner/` — `bootstrap.mjs` (SHA-256 manifest authentication before
  any candidate executes), `run-job.mjs` (manual CLI; exit codes keep
  DISABLED / ACTIVATION_REQUIRED / REFUSED / BUDGET_EXCEEDED visibly
  distinct), `make-manifest.mjs` (re-pin tool).
- `battery/` — 80 frozen cases (20 domain / 20 coverage-evidence /
  20 scope-capability / 20 budget-durability-security), an
  independent oracle (`oracle.js`, imports nothing from the
  evaluator), and `run-battery.js` (manifest-verified, 3 runs per
  case, byte-identical or it fails).
- `tests/` — node:test suites (modes/spoof, scope, coverage),
  manifest-verified via `tests/run-tests.js`.
- Domain code lives in `src/application/ai-lab/rental-ops/`
  (contracts, budgets, field mappings, snapshot builder, read
  adapter, the Property Manager evaluator, private-item serializer,
  decision validator) with vitest suites beside it.

## Run

```sh
npm test        # manifest verification, then the node:test suites
npm run battery # manifest verification, then the 80-case battery ×3
node runner/run-job.mjs --config <host-config.json> --request <job-request.json>
```

## Hard rules baked in

- Modes are a closed enum: `DISABLED` / `SYNTHETIC_PREVIEW`.
  Production-live is unconditionally `ACTIVATION_REQUIRED`; DISABLED
  returns before any adapter, credential, store or source is touched.
- One invocation budget (64 candidates, 256 KiB admitted input,
  depth 16, 512 evidence spans, 256 output records / 256 KiB),
  charged before inspection. Over-cap portfolios yield a named
  `BUDGET_EXCEEDED` refusal with no domain totals.
- The field allowlist admits no names, email, phone, SSN, income,
  screening, payment or free-text fields — opaque owner-scoped
  references only. Vacancy/occupancy are `NOT_MODELED` (an absent
  active lease does not prove vacancy). Overdue balances split
  FORGE-collectible vs externally-managed by the reviewed
  `isChargeForgeCollectible` rule; unknown escalation policy blocks
  the affected recommendation.
- Rental items and decisions NEVER enter Git: they publish through
  the host harness into the private Workbench store (forge-ai-drop
  `tools/agent-workbench/private-store.mjs`), an operator-owned state
  directory outside any clone. See `ACTIVATION-RUNBOOK.md` for what a
  future activation requires.
