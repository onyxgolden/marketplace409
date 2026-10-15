# Property Manager agent — Phase 2 slice 1 synthetic prototype

JSON exception dashboard with deterministic recommendations and escalation records, from registered synthetic fixture cases only. **Advisory only**: the agent proposes; it cannot charge, message, waive, edit, dispatch, determine legal questions, or execute anything (`execution_authorized_for_agent` is always `false`). No live tenant data, no live adapters, no model calls, zero runtime dependencies, pure Node 24 ESM.

## Layout

- `src/` — scored agent code: `index.js` (`run(task, context)` entry), `engine.js` (case resolution, permission checks, relay binding, urgency, advisory assembly), `schemas.js` (runtime validation), `injection.js` (seeded directive/identifier screens), `resolver.js` (budget model), `canonical.js` (deterministic hashing), `markdown.js` (optional static dashboard renderer).
- `fixtures/` — `store.json` (100 synthetic cases, notes, permission records, urgency table, escalation policy; every ID is an invented `SYN-*` ID), `trust.json` (principals, pinned relay records), `make-fixtures.js` (authoring tool).
- `corpus/` — `battery.json` (120 frozen cases with hand-derived expectations), `manifest.json` + `corpus_digest.txt` (SHA-256 pins), `make-battery.js` (independent oracle authoring tool — never imports `src/`), `freeze-corpus.js` (re-pins the corpus).
- `runner/run-manual.js` — manual single-case runner (not scored).
- `tests/` — `node:test` suite; `run-tests.js` / `run-battery.js` authenticate the corpus digest against the separately trusted `PM_APPROVED_ROOT` with node builtins **before** importing any scored code.

## Run

```sh
npm test      # trust bootstrap, then the full node:test suite
npm run battery  # trust bootstrap, then the 120-case acceptance battery
node runner/run-manual.js SYN-CASE-003 --claim SYN-RELAY-001
node runner/run-manual.js SYN-CASE-003 --markdown
```

## Input / output contract

Input: `{case_ref, workflow, context_filters:{property_fixture_ids}, requested_action:"recommend", note?, claimed_relay_ids?}`. `case_ref` must resolve through the registered fixture store (repo/path/commit/blob verified; blob = Git blob SHA-1 of the canonical case bytes). Unregistered IDs are rejected without echo; real identifiers (emails, phones, SSNs, addresses) and PII canaries in task content are rejected outright.

Output: `{status:"PROPOSED"|"BLOCKED"|"REFUSED", recommendations:[{recommendation_id, text, basis:[Citation], confidence, touchpoints, permission_check:{validity:"GROUNDED"|"UNGROUNDED", allowed_to_propose, evidence}, escalation_ids}], escalation_triggers:[{escalation_id, touchpoint, condition, reason, required_authorizer, executor, urgency, authorization_evidence_ids, authorization_satisfied, execution_authorized_for_agent:false}], contradictions:[], diagnostics:[...]}`.

## Key rules (from the brief)

- Every tenant/money/legal touchpoint requires an escalation trigger, even below urgency thresholds. Document-only inquiry is the positive trigger-free exception.
- Spending/tenant-contact authorizer: Jason (or his authorized Muse relay); executor: property operator after authorization. Legal touchpoints route to a qualified reviewer; the agent makes no legal determination.
- Urgency: immediate = seeded emergency safety condition; high = confirmed deadline within 48h or urgent maintenance; routine = other. Large spend bumps routine→high only; $0/small amounts never erase escalation. Unknown/conflicting config blocks rather than guessing.
- Pinned relay records bind action/target/scope/time; operator identity alone never satisfies a Jason-gated escalation. A valid existing relay record satisfies authorization without Jason repeating it.
- `allowed_to_propose` requires verified applicable permission evidence, never operational capability.
- Prohibited operations (`charge`, `send_message`, `waive_fee`, `edit_lease`, `edit_ledger`, `dispatch`, `legal_advice`, `delete_record`, `activate`) refuse with `ACTION_DENIED`; seeded directive-smuggling refuses with `INSTRUCTION_INJECTION` and quarantines the source.

## Corpus and acceptance (measured)

120 cases: 80 valid workflow (20 each maintenance/lease/rent/comms), 20 document-inquiry/evidence-conflict/permission-failure/config-conflict, 20 injection/prohibited/identifier/resolution probes. Expectations are hand-derived from the brief in `corpus/make-battery.js`, pinned by SHA-256 in `corpus/manifest.json`, bound into `corpus_digest.txt`.

Gates: 100% structural match on the battery; 100% seeded touchpoint escalation precision/recall; 100% refusal on prohibited operations; zero `allowed_to_propose=true` with unverified evidence; zero PII-canary output; repeat runs byte-identical under a fixed clock; mutation regressions (tampered source/oracle/expected/fixture/trust/manifest) stop before any case executes.

## Limitations

- Synthetic fixtures only; no live data, no adapters, no activation path.
- Evidence-conflict cases report contradictions and leave the affected recommendation UNGROUNDED (status BLOCKED) rather than resolving the conflict.
- The injection recognizer flags seeded families; security rests on absent capabilities and structured allowlists, not on regex claims of universal detection. Unknown attack coverage is not certified by a finite battery.
