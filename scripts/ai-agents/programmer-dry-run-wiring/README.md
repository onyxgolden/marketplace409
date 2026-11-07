# AI Lab P5-A — Programmer dry-run: contract + private presentation

P5-A of the AI Lab P5 programmer-agent dry-run scope
(`forge-ai-drop/results/chatgpt/ai-lab-p5-programmer-agent-dry-run-scope-2026-11-06.md`).
Contract and private presentation only. **No worktree creation, no
test execution, no real-branch run, no activation, no merge.**

## What this slice builds

In `marketplace409`:

- `src/application/ai-lab/programmer/` — the contract module, mirroring
  the `rental-ops` / `planning` layout:
  - `jobContracts.js` — job contract version, closed modes
    (`DISABLED` / `SYNTHETIC_PREVIEW`), one job descriptor
    (readiness honestly `CONTRACT_ONLY`), `JobRefusal`, `resolveMode`.
  - `mode.js` — OFF-by-default gate. Default mode is `DISABLED`.
  - `proposalSchema.js` — runtime validation of the v1 proposal
    artifact: exact base SHA, digests, bounded diff (≤3 files,
    ≤200 lines, ≤64 KiB, patch SHA-256 bound to the diff bytes),
    closed test-profile set, secret tripwires on display fields,
    safe relative paths only. Unknown fields refuse. Budgets and
    profile IDs are imported from the #610 prototype, never
    re-typed here.
  - `receiptMapping.js` — versioned mapping from a P3
    `qa-test-runner` receipt to the P5 verification state
    (`NOT_RUN` / `PASS` / `FAIL` / `BLOCKED`) and job lifecycle.
    Fail-closed: missing receipt, skipped suite, timeout, stale or
    mismatched digest, isolation failure, cleanup failure, budget
    overrun, or any unverified suite is never `VERIFIED`.
  - `decisionValidator.js` — P5 decision contract layered on the
    existing private decision shape (`accept` / `reject` /
    `send-back` → `ACCEPTED_FOR_CONSIDERATION` / `REJECTED` /
    `PENDING`). Accept approves for human consideration only — it
    never applies a patch. Append-only with expected-version
    compare-and-set; actor is server-derived, never a body field;
    stale digest refuses. Role scoping: read-only viewers cannot
    decide; cross-owner fails closed.
  - `privateItemSerializer.js` — private Workbench item with the
    canonical-tuple identity pattern (identical replay ⇒ identical
    item; changed content never silently overwrites — see
    `checkRepublish`). Kind `programmer-dry-run-proposal`.
  - `proposalRenderer.js` — pure, injection-resistant list + detail
    renderer conforming to the drop-side XSS contract: every value
    through `esc()`, record IDs gated by `validRecordId`, `data-*`
    attributes only, no inline handlers, no JSON-in-script, no
    fallback render for unknown agent/kind (`UNKNOWN_RENDERER`).
- `scripts/ai-agents/programmer-dry-run-wiring/` — this directory:
  - `fixtures/` — 7 frozen synthetic proposals + `manifest.json`
    with SHA-256 digests. Regenerate with `node fixtures/make-fixtures.mjs`.
  - `preview/run-preview.mjs` — inert preview harness (see below).
  - `descriptors/job-descriptors.json` — one job descriptor (DATA,
    not a scheduler registration).
  - `tests/` — node:test suites for fixtures + preview.

## What this slice deliberately does NOT do

- Does not modify `scripts/ai-agents/programmer-prototype/` (read-only
  reference) or `scripts/ai-agents/qa-test-runner/` (read-only reference).
- Does not create a worktree, run a test, run Git, touch the network,
  or spawn a shell.
- Does not add app routes, UI integration, scheduler registration,
  hooks, CI triggers, model/provider integration, or a production
  migration.
- Does not register the renderer or the decision endpoint in
  `forge-ai-drop` — that is a separate drop-side follow-up (see
  ACTIVATION-RUNBOOK.md). Until it lands, decision controls render
  disabled with the reason shown.

## Synthetic preview

```sh
# OFF by default — returns before opening any fixture (exit 10):
node preview/run-preview.mjs --fixture valid-verified --out /tmp/p5a-preview

# Synthetic preview — writes <name>.private-item.json + <name>.html (exit 0):
node preview/run-preview.mjs --fixture valid-verified --out /tmp/p5a-preview --mode SYNTHETIC_PREVIEW
```

Fixtures: `valid-verified`, `failed-verification`, `blocked-timeout`,
`not-run`, `malicious-strings`, `oversized-diff` (refuses on the
200-line budget), `stale-digest` (a decision bound to the verified
fixture's digest refuses against it).

## Tests

```sh
# Contract module (vitest, from the repo root):
npx vitest run src/application/ai-lab/programmer

# Wiring (node:test):
node --test tests/
```

## Pins

- Prototype: `POLICY_VERSION "pa2-policy-v1"`, `PROTOTYPE_VERSION "0.1.0"`,
  budgets imported from `scripts/ai-agents/programmer-prototype/src/constants.mjs`.
- P3 receipt shape: `scripts/ai-agents/qa-test-runner/src/schemas.js` + `report.js`.
- Private decision shape: `src/application/ai-lab/rental-ops/decisionValidator.js`
  and drop `tools/agent-workbench/private-decision.mjs`.
- Canonical JSON: reused from `src/application/ai-lab/rental-ops/canonical.js`.
