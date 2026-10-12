# QA / Inspection agent — Phase 2 slice 1 prototype

Fixture inspection-report generator plus inert ledger-row preview.
**Advisory only. Synthetic fixtures only. No live activation, no control
execution, no browser adapter, no tool calls.**

Implements brief `commands/muse/qa-inspection-agent-phase2-slice1-brief-2026-10-12.md`
under the shared slice-1 contract
`commands/muse/ai-lab-phase2-slice1-common-contract-2026-10-12.md`
(both in the `onyxgolden/forge-ai-drop` coordination repo).

## What it does

`run(task, context)` verifies synthetic evidence *about* UI controls and
returns an inspection report. It never performs inspection actions.

- **Input:** surface + build pin + controls (kinds: navigation, filter,
  expand, save, export, payment, send, production_write; operation:
  report or exercise) + evidence sources. The trusted fixture build
  registry binds `build_id` to commit/environment; task labels never
  establish build identity.
- **Evidence binding:** every evidence record is checked for build/commit/
  environment match, independently resolved run_id, recomputed artifact
  digest over actual registered bytes, scoped read grant, structured
  observed-vs-expected assertion, and injection quarantine. Screenshot
  presence alone never proves Save/export behavior.
- **Output:** `REPORTED` / `BLOCKED` / `REFUSED`, per-control assertion
  results, per-modality results, contradictions (both modalities retained,
  never averaged), and an inert `ledger_preview` whose rows are all marked
  `SYNTHETIC` and never update the real ledger.
- **Classification:** no usable evidence → `UNVERIFIED`; denied/unreachable
  read or wrong-build evidence → `BLOCKED`; verified observed failure →
  `FAIL`; opposing outcomes → contradiction flagged, `FAIL` if any verified
  failure, never overall `PASS`. Overall `PASS` only when every required
  assertion *and* modality is verified and matching, with no contradiction
  and no blocking evidence. Exercise of payment/send/production_write/
  persistent-save → `REFUSED` (`ACTION_DENIED`); exercise of anything else
  → `REFUSED` (`EXERCISE_UNSUPPORTED`) — denial only, nothing executed.

## Layout

```
scripts/ai-agents/qa-inspection-prototype/
  src/
    index.js        public entry: run, schemas, resolver, renderers
    classify.js     run(task, context) — binding + classification core
    schemas.js      strict runtime validators (unknown props rejected,
                    enums, duplicate IDs, 40-hex pins, real dates)
    resolver.js     FixtureResolver — the only read path (in-memory)
    injection.js    seeded directive-family recognizer (quarantine only;
                    security comes from allowlists, not the regex)
    ledger.js       inert ledger-row preview (SYNTHETIC rows)
    markdown.js     optional Markdown renderer (consumes report JSON)
  runner/
    run-manual.js   standalone manual runner (canonical JSON to stdout;
                    writes only with explicit --out)
  fixtures/         default demo fixtures for manual runs
  corpus/
    battery.json    200 frozen cases + hand-derived expectations
    manifest.json   SHA-256 of every scored-path file (sorted)
    corpus_digest.txt
    make-battery.js battery authoring tool (deterministic)
    freeze-corpus.js manifest authoring tool
  tests/
    battery.test.js 200-case acceptance battery (manifest verified first)
    mutation.test.js tamper oracle/expected/fixture/registry/manifest → stop
    schemas.test.js  malformed inputs denied, never exceptions
    determinism.test.js byte-identical repeats, detached snapshots
    zerotools.test.js zero tool calls, no side-effect imports
    harness.js      manifest verifier + battery executor
    run-battery.js  `npm run battery` CLI
```

## Run it

```bash
node --test tests/*.test.js        # full suite (35 tests)
npm run battery                    # 200-case acceptance battery
node runner/run-manual.js --task <task.json> --fixtures fixtures [--out <dir>] [--markdown]
```

## Acceptance (measured 2026-10-12)

- 200/200 classification + evidence-binding match vs frozen expectations
- Contradiction precision 24/24 and recall 24/24 on seeded pairs
- 0 unsupported PASS/FAIL (every PASS/FAIL rests on verified bound evidence)
- 40/40 prohibited-exercise refusal (denial-only, `action_taken: "none"`)
- 40/40 injection quarantine (seeded directive families)
- 0 tool calls; 200/200 byte-identical repeat runs under fixed clock
- 5/5 mutation targets stop before any case executes

## Limitations (explicit non-goals)

- Prototype only: no live intake, no browser, no control execution, no
  model calls, no network, no production data, no activation.
- Fixture evidence only; a CI PASS proves the named automated assertion,
  never manual/live verification. No replay or carry-forward between
  builds in slice 1.
- The injection recognizer flags seeded families; it does not certify
  unknown attack coverage.
- Ledger preview is inert and advisory; the real
  `UI-CLICKTHROUGH-LEDGER.md` is never touched by this module.
- Unknown attack coverage is not certified by passing a finite battery.
