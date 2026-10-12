# Engineering Manager agent — Phase 2 slice 1 prototype

Deterministic, bounded **structured-brief-to-DAG planner**. Given a pinned
fixture brief, it produces an advisory plan DAG: stable content-hashed node
IDs, validated dependencies, cycle detection, external-gate records, and
mock trusted approval routing for restricted scopes. Advisory only — it
never assigns work, approves anything, writes files, or executes anything.

## Layout

- `src/index.js` — `run(task, context)` entry; common advisory envelope
- `src/planner.js` — brief → DAG: validation, topo sort, cycles, approvals, budgets
- `src/schemas.js` — strict runtime schemas (unknown props rejected, pins are 40-hex)
- `src/approvals.js` — mock trusted approval store resolution (separately injected)
- `src/canonical.js` — canonical JSON + SHA-256 stable node IDs
- `src/injection.js` — seeded injection recognizer (classifier only, not a boundary)
- `src/markdown.js` — optional Markdown renderer (consumes the JSON, invents nothing)
- `fixtures/` — owner registry, principal/authority table (briefs + approvals are
  injected per-case via context in the corpus)
- `corpus/battery.json` — 100 frozen cases (50 approved + 50 negative) with
  hand-derived expectations
- `corpus/manifest.json` + `corpus/corpus_digest.txt` — pinned file hashes + digest
- `runner/run-manual.js` — standalone manual runner (`node runner/run-manual.js <task.json> <context.json> [md]`)
- `tests/` — battery, determinism, schemas, mutation, zero-side-effect tests

## Usage

```bash
npm test      # unit suites (trust-authenticated)
npm run battery  # 100-case acceptance battery (trust-authenticated)
node runner/run-manual.js <task.json> <context.json> md
```

## Behavior summary

- Input: `{brief_ref, objective_id, constraints:{budget_units,max_nodes,owner_allowlist}, requested_action:"plan", related_brief_refs[]}`.
- The fixture brief supplies `{objective_id, scope_ids, task_specs[], non_goals[]}`; prose outside the schema is untrusted commentary.
- Missing/unresolvable brief → one BLOCKED placeholder node (`SOURCE_UNVERIFIED`), never silent output.
- Node ID = SHA-256 of canonical `{brief:{repo,path,blob}, objective_id, local_key}`.
- Duplicate local keys rejected (first wins, diagnostic recorded); dangling dependencies, invalid owners, empty acceptance gates block their nodes; cycles block the whole DAG.
- External gates are explicit UNRESOLVED records — never executable, never auto-cleared.
- Prohibited actions (`run_migration`, `deploy`, `execute_script`) → REFUSED with `ACTION_DENIED`; denial record only.
- Restricted scopes (`financial`, `tenant`, `enrollment`, `production`) and restricted actions need a valid Jason-origin approval from the separately injected store, or affected nodes stay BLOCKED. Valid approval → `approval_verified` + `simulated_approved` routing flags (routing test only, never a capability).
- `assignment_authorized` is always false. Output order is a stable topological order with task-ID tie-break: permutations of independent declarations yield the same DAG.
- Budgets: 256 KiB input, 64 resolved objects, 512 spans, 256 output records, 256 KiB output. Exhaustion → denial, never partial success.

## Limitations

- Synthetic fixture scaffolding only. No real `commands/` intake, no task assignment, no notifications, no code/patch/migration generation, no dispatch, no approval minting, no deployment, no general NL planner.
- The mock approval store is a test double labeled as such; nothing here is production identity or signing.
- Injection recognition covers seeded families only; real safety comes from the absence of execution capabilities.
