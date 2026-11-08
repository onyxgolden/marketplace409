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
    mismatched digest, checkout-head mismatch, isolation failure,
    missing or incoherent suite counts, inconsistent totals,
    cleanup failure, budget overrun, or any unverified suite is
    never `VERIFIED`. In particular P5-A emits no VERIFIED from a
    bare P3 v1 receipt at all: the v1 report carries no
    candidate-tree digest, so an all-PASS receipt maps to BLOCKED
    (`CANDIDATE_IDENTITY_UNPROVEN`) until P5-C binds the candidate.
  - `decisionValidator.js` — P5 decision contract layered on the
    existing private decision shape (`accept` / `reject` /
    `send-back` → `ACCEPTED_FOR_CONSIDERATION` / `REJECTED` /
    `PENDING`). Accept approves for human consideration only — it
    never applies a patch. Append-only with mandatory
    expected-version compare-and-set (an omitted version refuses);
    a same-ID replay must bind the same decision bytes or it
    refuses; actor is server-derived, never a body field;
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
node preview/run-preview.mjs --fixture unbound-all-pass --out /tmp/p5a-preview

# Synthetic preview — writes <name>.private-item.json + <name>.html (exit 0):
node preview/run-preview.mjs --fixture unbound-all-pass --out /tmp/p5a-preview --mode SYNTHETIC_PREVIEW
```

Fixtures: `unbound-all-pass` (every suite passes, but the P3 v1
receipt proves no candidate identity, so it maps to BLOCKED),
`failed-verification`, `blocked-timeout`,
`not-run`, `malicious-strings`, `oversized-diff` (refuses on the
200-line budget), `stale-digest` (a decision bound to the unbound
fixture's digest refuses against it).

## P5-B — trusted local worktree evaluator (this slice)

P5-B adds the evaluator to the same contract module. **No test
execution, no real-branch run, no activation, no merge.** It
validates one bounded candidate against a pinned local mirror and
applies it to disposable scratch only, recording immutable
diff/tree provenance. It executes no candidate code.

In `marketplace409`:

- `src/application/ai-lab/programmer/worktreeEvaluator.js` — pure
  domain: evaluation record `programmer-worktree-evaluation@1`
  (frozen, exact field set, append-only audit), candidate-tree
  digest (`p5b-candidate-tree-v1`: SHA-256 over
  `<mode> <git-blob-sha1>\t<path>` lines sorted by path), tree
  hygiene (refuses symlink/gitlink/`.git`/case-collision), mirror
  config denylist (includes, hooks path, filters, credentials,
  transport overrides), job/candidate validation, porcelain-vs-plan
  check, canonical-diff normalization, replay binding
  (idempotency key ⇒ one job + task + base + candidate diff;
  changed base refuses `STALE_DIGEST`), in-memory idempotency
  store. No I/O, no git, no processes.
- `src/infrastructure/ai-lab/programmer/worktreeHost.js` — host
  adapter: scrubbed git env (`GIT_CONFIG_NOSYSTEM=1`,
  `GIT_OPTIONAL_LOCKS=0`, no prompt), host-owned temp home,
  hooks neutralized (`core.hooksPath` → empty host dir),
  `protocol.allow=never`, mirror validation (offline, exact
  commit, clean tree, no hooks/filters/submodules), detached
  disposable worktree under a host-owned root, snapshot from
  `ls-tree`/`cat-file`, prototype plan validation with host-owned
  constraints, byte-level apply to scratch (never `git apply` of a
  caller string), canonical diff + provenance, before/after
  refs/HEAD/index-content + outside-root canaries, try/finally
  cleanup that removes only the identity-verified job-owned
  worktree (never `--force`; cleanup failure ⇒
  `BLOCKED`/`CLEANUP_FAILED`, never `VERIFIED`), and
  `reconcileStaleWorktrees` — explicit operator recovery only,
  never a scheduler; foreign worktrees are listed as skipped and
  never touched.
- `scripts/ai-agents/programmer-dry-run-wiring/evaluator/` — this
  slice's harness:
  - `fixtures/` — 9 frozen synthetic scenarios + `manifest.json`
    with SHA-256 digests + deterministic local Git mirrors under
    `fixtures/repos/`. Regenerate with
    `node fixtures/make-evaluator-fixtures.mjs`.
  - `preview/run-evaluator-preview.mjs` — inert preview harness
    (see below).
  - `tests/evaluator.test.js` — node:test integration suite
    (fixtures, preview CLI, idempotency, crash/retry, base-mutation
    replay, reconciler, isolation attestation).

### Isolation — read this before running anything

P5-B executes no candidate code: the only processes it spawns are
fixed-argv git commands under a scrubbed environment. The isolation
probe (`qa-test-runner` `detectIsolation`, only `bwrap`/`unshare`
count) is therefore **attested on every record, not a gate on
validation/apply/provenance** — but a null mechanism is recorded
as a risk and the record states plainly that it does **not**
authorize execution. **P5-C must re-probe and prove isolation
before running any candidate test**; on a host with no proven
mechanism, candidate execution is blocked there
(`ISOLATION_BLOCKED`). A Git worktree alone is not a sandbox, and
this slice never claims it is. On the build VM neither mechanism
proves itself (bwrap fails bringing up loopback; unshare cannot
bind-mount the container rootfs), so records there carry
`mechanism: null` + the execution-gate note — the fail-closed
behavior is the proof, not a gap to work around.

### Synthetic preview (P5-B)

```sh
# OFF by default — returns before opening any fixture (exit 10):
node evaluator/preview/run-evaluator-preview.mjs --fixture clean-propose --out /tmp/p5b-preview

# Synthetic preview — writes <name>.evaluation.json (exit 0 for any terminal status):
node evaluator/preview/run-evaluator-preview.mjs --fixture clean-propose --out /tmp/p5b-preview --mode SYNTHETIC_PREVIEW
```

Fixtures: `clean-propose` (PROPOSED), `drifted-base`,
`forged-hook`, `forged-auth`, `malicious-filter`,
`symlink-tree`, `traversal-diff`, `oversized-diff`
(all BLOCKED), `hostile-capability` (REFUSED).

### Tests (P5-B)

```sh
# Pure domain module (vitest, from the repo root):
npx vitest run src/application/ai-lab/programmer/worktreeEvaluator.test.js

# Evaluator integration (node:test):
node --test scripts/ai-agents/programmer-dry-run-wiring/evaluator/tests/evaluator.test.js
```

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
