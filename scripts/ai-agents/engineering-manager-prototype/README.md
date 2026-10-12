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
- Source binding: the resolver binds commit:path to actual bytes, recomputes the Git blob SHA-1 (`blob <len>\0<bytes>`) from the resolved bytes and compares it to the pin, requires `brief.objective_id == task.objective_id`, and validates every `source_spans` entry as an exact UTF-8 byte range of the resolved bytes. Mismatches fail closed (`HASH_MISMATCH`, `OBJECTIVE_MISMATCH`, `SPAN_INVALID`). Nodes carry grounded evidence in the common contract's single provenance schema: `SourceRef = {repo, path, commit, blob, algorithm:"git-sha1", revision}` and `Citation = SourceRef + {quoted_span, span:{start_byte,end_byte,quoted_text}, verification:"VERIFIED"}` — the blob is the independently recomputed binding, `quoted_span` and `span.quoted_text` both equal the exact UTF-8 slice, and the whole-brief evidence is a complete verified SourceRef with role `whole-brief-verified-source`. (`validateSourceSpans` checks range well-formedness only; excerpts are derived from verified bytes, never asserted quotations.)
- Node ID = SHA-256 of canonical `{brief:{repo,path,blob}, objective_id, local_key}`.
- Duplicate local keys invalidate the whole graph — every retained node is explicitly BLOCKED (`DUPLICATE_LOCAL_KEY`), never a first-wins repair; dangling dependencies, invalid owners, empty acceptance gates block their nodes; cycles block the whole DAG.
- Related briefs are resolved under the same source binding and compared by canonical semantic comparison over all control-bearing fields (title, owner, action_ids, dependency keys, acceptance checks, external gates); conflicts block affected nodes with evidence-linked diagnostics. Unverifiable related sources yield explicit `UNRESOLVED_RELATED_SOURCE` uncertainty flags and the public `complete` flag is `false` — never silent success, never `complete:true` over incomplete coverage.
- External gates are explicit UNRESOLVED records — never executable, never auto-cleared.
- Prohibited actions (`run_migration`, `deploy`, `execute_script`) → REFUSED with `ACTION_DENIED`; denial record only.
- Restricted scopes (`financial`, `tenant`, `enrollment`, `production`) and restricted actions need a valid Jason-origin approval from the separately injected store, or affected nodes stay BLOCKED. The approval's `subject_ref` must exactly match the resolved brief source (repo/path/commit/blob); coverage is checked against the authenticated `scope_ids`/`action_ids` with supplemental `approved_*` sets that may only narrow; relay issuers need a registered, Jason-registered, unrevoked, currently-valid relay. Valid approval → `approval_verified` + `simulated_approved` routing flags (routing test only, never a capability).
- `assignment_authorized` is always false. Output order is a stable topological order with task-ID tie-break: permutations of independent declarations yield the same DAG.
- Budgets: 256 KiB total input UTF-8, 64 resolved objects, 512 spans, 256 output records, 256 KiB output. Scoped charging model: the task envelope, the primary brief, each related brief, the owner registry (one consulted store object), the approval store envelope plus each inspected approval record, and the relay registry envelope plus each inspected registration record are all counted as objects and/or UTF-8 payloads. The relay registry is bounded before scanning, so a padded registry cannot authorize restricted routing; every consulted registration is schema-validated strictly before use (required `revoked` boolean, calendar-valid dates, known properties only, no duplicate conflicting IDs). Output records cover the complete envelope (nodes + edges + gates + conflicts + diagnostics + quarantined + routing flags, including early refusals); the byte cap is enforced on the EXACT final public envelope (payload plus envelope fields), and exhaustion yields a small `complete:false` refusal with no domain success. Exhaustion → denial, never partial success. The battery runs each case in a worker thread under a 5s host watchdog; a stuck case is terminated and refused with `WATCHDOG_TIMEOUT`.

## Limitations

- Synthetic fixture scaffolding only. No real `commands/` intake, no task assignment, no notifications, no code/patch/migration generation, no dispatch, no approval minting, no deployment, no general NL planner.
- The mock approval store is a test double labeled as such; nothing here is production identity or signing.
- Injection recognition covers seeded families only; real safety comes from the absence of execution capabilities.
