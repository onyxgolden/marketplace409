# Governance Agent — Phase 2 slice 1 prototype

Deterministic **policy applicability and gate-evidence checklist** for synthetic
fixture policies. Pure Node 24 ESM, zero runtime dependencies, zero model
calls. Advisory only: it maps pre-registered synthetic policies to synthetic
requested actions and returns a classification — it never authorizes,
executes, merges, deploys, activates, writes, spends or sends anything.

Location: `scripts/ai-agents/governance-prototype/` in `onyxgolden/marketplace409`.

## Entry

`run(task, context) -> result` from `src/index.js`.

- `task`: `{request_id, requested_action, actor_ref, action_type,
  target:{repo, resource_id, resource_class, scope_ids, head, source_ref},
  payload_context:{evidence_record_ids:[]}}`. Only `requested_action:
  "classify"` is evaluable; `execute_action` (or any grant/register/approve
  operation) is `REFUSED/ACTION_DENIED`. Strict schemas reject unknown
  control fields, bad enums, duplicate IDs, abbreviated pins and unsafe paths.
- `context` is separately injected host state (fixed clock, principals,
  policies, registrations, verdicts, agreements, relays, head registry,
  read grants, Git-blob store, evidence). All identity channels are
  SIMULATED fixtures.

## Decision order

1. Invalid/prohibited agent operation → `REFUSED`, `UNGROUNDED`, `DENIED`.
2. Missing/unverifiable/inapplicable authority, target/evidence conflict →
   `CLASSIFIED`, `UNGROUNDED`, `DENIED`, `complete:false`.
3. Verified explicit prohibition → `CLASSIFIED`, `GROUNDED`, `DENIED`.
4. Verified applicable rule with unmet approval/agreement requirements →
   `CLASSIFIED`, `GROUNDED`, `NEEDS-APPROVAL` (satisfied requirements stay
   listed; `responsible_actor` routes to Muse / the designated reviewer /
   Jason or his authorized relay).
5. All registered applicable conditions satisfied → `CLASSIFIED`,
   `GROUNDED`, `ALLOWED` with `authorization_granted:false`,
   `execution_performed:false`.

Unknown actions/scopes default to denial. Conflicting effective
registrations resolve only through an authenticated precedence rule;
ties fail closed. A superseding NEEDS-CHANGES/NO-GO invalidates an older
GO. `authorization_granted` and `execution_performed` are always false.

## Layout

- `src/` — `index.js` (entry), `evaluate.js` (decision order),
  `schemas.js` (strict runtime schemas), `resolver.js` (bounded fixture
  resolver, budgets, Git-blob verification), `injection.js` (seeded
  directive recognizer), `simulator.js` (consumption revalidation),
  `markdown.js` (inert audit preview), `canonical.js` (hashing).
- `fixtures/` — `make-fixtures.js` generator; `store.json` (principals,
  8 policies, 7 registrations, 6 verdicts, 2 agreements, 1 relay,
  9 head entries, blob store, 7 evidence records); `values.json`
  (derived ids shared with the corpus generator).
- `corpus/` — `make-battery.js` (authors the 120 cases + 12 mutations),
  `battery.json`, `mutations.json`, `freeze-corpus.js`,
  `manifest.json`, `corpus_digest.txt`.
- `runner/` — `run-manual.js` (one-off evaluation), `run-simulation.js`
  (manual two-stage mutation driver).
- `tests/` — `run-tests.js` (GOV_APPROVED_ROOT pre-import bootstrap),
  `run-battery.js` (official battery CLI), `harness.js`, `case-worker.js`,
  `watchdog.js`, plus `*.test.js`.

## Corpus and gates

120 frozen cases: 20 positives, 20 prohibitions/malformed, 20 authority
attacks, 20 binding/freshness, 20 requirement/routing, 20
ambiguity/injection — plus 12 two-stage consumption mutations
(head/policy/evidence/principal/relay changes).

Gates: 120/120 expected classification/validity/requirement/routing
match; 12/12 stale evaluations invalidated; zero unregistered-policy
`ALLOWED`; zero `ALLOWED` with `UNGROUNDED`/incomplete coverage; zero
invented approvers; zero advisory output accepted as authority; three
byte-identical repeat runs; mutation regressions stop before execution.

## Trust root

`GOV_APPROVED_ROOT` is a separately trusted host input (pinned in the npm
scripts at freeze time). `tests/run-tests.js` recomputes the full corpus
digest with node builtins only and refuses (exit 3) before importing any
scored code when the digest differs. Corpus changes require a new digest
and a new implementation head.

## Running

```sh
npm test        # trust bootstrap + full node:test suite
npm run battery # official 120-case battery report
node runner/run-manual.js merge pr:707 principal:claude --md
node runner/run-simulation.js gov-m-01
```

## Limitations (explicit non-goals)

No live policy changes, no policy invention, no universal compliance
claims, no risk scoring, no general natural-language adjudication, no
autonomous enforcement/approval/merge/deploy, no notifications, no
cross-agent integration. Classifying synthetic rules does not validate
production identity or registry security.
