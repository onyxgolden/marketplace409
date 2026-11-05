# AI Lab P1-C — Research Workbench UI and end-to-end preview

P1-C is the third of three separately reviewed P1 slices (brief:
`results/chatgpt/ai-lab-p1-research-job-definition-scope-2026-11-04.md`
in forge-ai-drop). It puts the Research job contract (P1-A) and the
transport adapter (P1-B) in front of a human operator: a disabled
job list, a job detail page with an explicit manual synthetic
preview, an evidence/citation viewer, and per-item accept/reject
with a revision receipt, all against the existing private Workbench
store. It is a UI and a host harness, not a service.

## What this slice contains

- `src/render.js` — pure HTML rendering (job list, run card,
  evidence viewer, decision forms, all-decided banner, error pages).
  Every interpolated value is escaped with the same `esc()` the
  drop's closed renderer registry uses. There is no control that
  could turn a job on, arm a recurrence, or start live work.
- `src/jobs.js` — the disabled job registry. Job definitions are
  operator-authored JSON files in a jobs directory outside Git,
  validated through the P1-A contract at load; any non-DISABLED
  definition, scope mismatch, malformed file, or duplicate job_id
  refuses the whole registry. `fixtures/generac-weekly-brief.json`
  is the seeded demo definition (the 8-item synthetic Generac
  replay, scope op-1/ws-1).
- `src/host.js` — `createResearchWorkbenchHost()`: a pure request
  handler over the P1-B transport. Routes under `/research`: list,
  job detail, manual preview, per-item decide. Bodies are strictly
  allowlisted and size-capped; the decision actor is the
  server-configured identity, never a request field; a body `actor`
  refuses. Re-posting a preview form replays idempotently; a new
  preview needs a freshly rendered invocation id. A decision on a
  refreshed preview refuses `STALE_DIGEST`.
- `src/server.js` — the operator host entry. Opens the REAL private
  store (drop `tools/agent-workbench/private-store.mjs`) and serves
  the UI on 127.0.0.1 only. Without the drop's store module it
  refuses to start — there is no fallback store. Non-loopback
  `--host` refuses. The store directory must live outside any Git
  working tree and outside the drop clone (the store enforces this).
- `src/errors.js` — the coded refusal type (mirrors P1-A/P1-B).

## Decision semantics — read this before wiring anything else

ACCEPT means **accepted for human consideration** — never approval
to write production data, activate an agent, contact anyone, spend,
or enqueue execution. A decision record is review metadata only; no
external action executes from it. A closed loop is review
completion only — never activation. Activation remains a distinct
Jason-only decision, not granted by merge, publish, or decision.

## Running it (operator host)

```sh
node src/server.js --state-dir /path/outside-git/private-state \
  --jobs-dir /path/outside-git/research-jobs \
  --port 0 --operator-ref op-1 --workspace-ref ws-1 --actor operator-1
```

The jobs directory must contain validated, DISABLED definitions
scoped to the same principal (copy
`fixtures/generac-weekly-brief.json` and set your own refs). The
server prints its loopback URL; open it, pick a job, run a
synthetic preview, decide each item. Restarting the server against
the same state directory preserves jobs, runs, and decisions —
persistence lives in the private store, not the process.

## Tests

```sh
node tests/run-tests.js   # render (7) + jobs (6) + host (9) + e2e (1)
```

The e2e suite boots the real server against the real private
store in a temp state directory, drives list → preview → decide
all 8 Generac items → closed loop over loopback HTTP, restarts
the server, and verifies the decisions persisted. It skips with a
printed reason when the forge-ai-drop checkout is absent.

## What this slice deliberately does NOT contain

- No scheduler, cron, timer, queue, or background run of any kind.
  Recurrence stays a stored declarative rule + preview math.
- No activation toggle, enable path, or live execution path — in
  code, routes, or UI. No migration, no production read/write,
  no tenant/financial/enrollment data, no second store or
  transport, no public endpoint. The eventual authenticated route
  (outside this slice) must derive the principal and actor from
  trusted session state, as the P1-B README requires.
- No changes to P1-A or P1-B contract code: this slice only reads
  their public APIs (`validateJobDefinition`, `buildPreview`
  via the transport, `createResearchTransport`, the fixture
  corpora). The one behavioral note for reviewers: a changed
  decision on an already-decided row is an explicit new revision
  with history (per the brief), not an overwrite — the store's
  `DECISION_CONFLICT` fires only when the same decision_id
  carries different material.
