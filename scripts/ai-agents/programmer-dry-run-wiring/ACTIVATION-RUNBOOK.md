# ACTIVATION RUNBOOK — Programmer dry-run (P5)

Status: **NOT ACTIVATED. No live mode exists in this release.**

## Gates (all Jason-gated, each a separate explicit word)

1. **P5-A merge** — needs ChatGPT exact-head review + Jason's merge word.
   This slice alone. (MERGED Nov 7, PR #749, squash `614134cb`.)
2. **P5-B merge** — needs ChatGPT exact-head review + Muse's
   agreement check under the standing order (GO + check = merge).
   P5-B alone: no P5-C/D, no real-branch dry runs, no activation.
3. **P5-C / P5-D** — separate slices, separate reviews. None is
   authorized by P5-A or P5-B.
4. **Real-branch dry runs** — need Jason's separate explicit
   authorization per agent/per trial. Synthetic fixtures are the only
   runs in this slice, and they never touch a real branch.
5. **Activation (any live mode)** — needs Jason's per-agent/per-trial
   word plus a separately reviewed change that adds a live mode.
   There is deliberately no code path in this release that turns a
   caller value into a live mode.

## What "OFF" means

- Default mode is `DISABLED`. The preview harness returns (exit 10)
  before opening any fixture, adapter, store, or source.
- `SYNTHETIC_PREVIEW` loads frozen synthetic fixtures only.
- A request for anything live-shaped (`LIVE`, `PRODUCTION`,
  `REAL_BRANCH`, or any other caller mode value) refuses with
  `ACTIVATION_REQUIRED`.

## Drop-side follow-up (separate change, separate review)

Registering the new renderer and decision endpoint in `forge-ai-drop`
is NOT part of this slice:

- `tools/agent-workbench/renderers.mjs` — register the
  `programmer-dry-run-proposal` kind (closed registry; same XSS
  contract this slice's renderer already conforms to).
- `workbench.html` — list/detail wiring for the new kind.
- `tools/agent-workbench/private-decision.mjs` — a programmer
  decision adapter endpoint (`/workbench/api/private/programmer-decision`),
  reusing `decisionFromBody` semantics with the P5 human-state mapping
  (`accept` → `ACCEPTED_FOR_CONSIDERATION`, never applies anything).
- `tools/agent-workbench/private-store.mjs` — no change expected;
  the item shape is already store-compatible.

Until that follow-up lands, the preview renderer shows decision
controls disabled with the reason stated on the page.

## If a future slice activates anything

- Activation is per agent, per trial, for Jason's explicitly named
  owner/scope, field allowlist, read principal, retention settings,
  clock policy and schedule — the P2a activation contract, unchanged.
- A failed qualification leaves the agent disabled and produces a
  fix slice; it never silently enables a mode.
- Accept never applies a patch, creates a branch, launches a PR,
  enqueues work, schedules, or activates anything — in any slice.
