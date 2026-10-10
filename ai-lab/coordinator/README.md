# AI Lab Coordinator — Phase 2 fixture-only prototype

A read-only, deterministic **evidence and state-classification engine**
implementing the approved Coordinator v6 contract (Phase 1 discovery
`results/muse/ai-agent-ai-lab-coordinator-phase1-discovery-v6.md` in the
forge-ai-drop repo). It classifies task state, review state, Muse
agreement, Jason authorization, and merge eligibility as independent flags.

This prototype **executes nothing**. There is no merge, deploy, network,
filesystem-write, GitHub, cron, or email capability in this module, and no
route/page in the app imports it. `SESSIONS_ENABLED` is untouched.

## Run the tests

```bash
npx vitest run ai-lab/coordinator
```

(The repo's `npm test` also picks these files up via the default vitest
include glob.)

## Layout

| File | Role |
|---|---|
| `principals.mjs` | Five fixed principals (`jason`, `koe-sr`, `koe-jr`, `claude`, `chatgpt`). Text attribution resolution — descriptive only, never authentication. Bare "Muse" → `UNRESOLVED("muse")`. |
| `trusted.mjs` | Injected `TrustedProvenanceRegistry` + `TrustedChannelStore`. The only source of authenticated provenance; populated by fixtures as ground truth. The Coordinator only calls their read methods — it never mints, refreshes, extends, or revokes records. |
| `tokens.mjs` | v6 `RatificationToken` validation: trusted issuer (`jason-muse-channel`), principal `jason`, scope coverage, task/head binding, issued/expiry, revocation — checked on **every** evaluation. |
| `artifacts.mjs` | Allowlisted synthetic artifact kinds under the `synthetic/` path namespace; immutable artifact identity `{path, content_sha256}`; dedup key `(task_id, source_file_id)`. Instruction-like body text is flagged as inert data. |
| `coordinator.mjs` | Ingest (allowlist, dedup, owner-mismatch quarantine) + `evaluate()` producing the classification: independent flags with source-referenced reasons. |
| `coordinator.test.mjs` | Phase 1 fixtures 1–18 ported to tests + the Phase 2 brief's explicit cases. |
| `properties.test.mjs` | Property-style checks: authorization never increases when trusted records are removed/revoked/expired; evaluation is deterministic. |

## Contract invariants

- `merge_eligible=true` **only** when the latest review is a GO bound to the
  current code head, the Muse agreement check is independently attested
  (registry entry or channel token), and Jason's authorization is
  substantiated by a trusted record. It is an informational classification —
  the prototype never acts on it.
- Missing/invalid provenance fails closed: provenance `unknown`, displayed
  as **"authorization provenance unknown"**, with `jason_authorized`,
  `agreement_check_passed`, and `merge_eligible` all `false`.
- Standing rules are policy (what the channel *may* ratify), never
  evidence. Authorization via a standing rule still requires a standing
  channel token plus an attested agreement check evidencing **every**
  declared precondition.
- Historical merges recorded without tokens keep provenance `unknown` and
  are **not** retroactively invalidated.
- Free-text instructions inside artifacts are inert data
  (prompt-injection rejection): only structured, allowlisted fields are
  ever read.

## Not built here (future, separately authorized work)

Real authenticated Jason–Muse channel integration (token minting, issuer
authentication, revocation transport), any scheduler/execution, live
approvals, CI wiring, and persistence. The trusted stores here are
in-memory fixture doubles for that future channel.
