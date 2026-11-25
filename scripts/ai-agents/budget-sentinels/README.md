# Budget sentinels — public-entrypoint poisoned-tail contract

FORGE-P-20261015-CHATGPT-BUDGET-SENTINELS (28-row bundle, row 4).
Three-agent agreement: ChatGPT AGREE, Muse AGREE WITH CONDITIONS (five,
below), Claude AGREE (Nov 21). Jason triaged Nov 22: BUILD in the
background queue.

## What this pack is

A small repo-local test/fixture contract for bounded AI-agent entrypoints.
It proves, through a public `run()` path, that an agent's budget is a
**sentinel, not a suggestion**: every candidate is charged BEFORE its
fields are read, so a candidate past the budget dies on the charge and is
never inspected at all.

- `sentinel-fixtures.js` — reusable fixture helpers only (throwing Proxy /
  getter tails, descriptor-safe inspection, raw spans, filler ids). Node
  builtins only. **Never a shared runtime dependency**: no agent runtime
  code imports this module.
- `tests/budget-sentinels.test.js` — the contract tests, proven through the
  Document Agent prototype's public `run()` (the DOC-002 defect is the
  most precisely specified of the three cited reviews).
- `tests/run-tests.js` — plain `node --test` entrypoint.

Run it: `node scripts/ai-agents/budget-sentinels/tests/run-tests.js`

## The three defects this catches (the cited reviews)

- **#626 Financial Manager** — repeated fix rounds before candidate 65 was
  truly unread: traversal happened before the charge.
- **#632 Customer Success** — trusted-looking context accepted unbudgeted:
  the trusted registry was enumerated before the budget saw it.
- **#633 Document Agent (DOC-002)** — `validateContext()` enumerated all
  sources/revisions/grants before the budget saw them; an unused 300,000-
  byte revision still returned `REPORT_READY`. Nested sections/markers/
  edges were charged as one object with their owning document.

## The five conditions, and how each is met

1. **Tests/fixtures/documentation only.** No runtime file is touched, no
   shared runtime dependency is created, and no agent's budget semantics,
   classification rules or authorization policy changes. (Verified: this
   PR adds files under `scripts/ai-agents/budget-sentinels/` only.)
2. **Fixture helpers yield raw structural spans without unescaping or
   interpreting any candidate's fields.** Setup uses
   `Object.defineProperty`, `Reflect.ownKeys` and
   `Object.getOwnPropertyDescriptor` only — never property access,
   `JSON.stringify`, spread or `structuredClone` on a value that may
   carry a throwing tail. The suite has an explicit setup-safety test
   asserting `touched() === false` after construction AND after insertion
   into a context object. (Found while probing: `JSON.stringify` of a set
   containing a throwing-getter section threw in setup, before `run()`
   ran — the harness, not the agent, had tripped the poison.)
3. **The #632 case is explicit.** Two tests: trusted filler sources share
   the task budget (25 trusted sources push the run over the cap; the
   same task without them passes), and an unused 300,000-byte trusted
   revision refuses `INPUT_LIMIT` — the DOC-002 exact reproduction.
4. **Negative control.** A fully valid in-budget bundle passes
   (`REPORT_READY`), and the exact-boundary controls pass at exactly 64
   object charges — so the sentinel cannot degenerate into refusing
   everything.
5. **Per-agent adoption is separately reviewed.** Each agent copies/adapts
   these probes under its own authenticated manifest. This PR demonstrates
   the contract on the Document Agent only; it never silently overrides
   any agent's existing test semantics.

## What the contract proves (all through public `run()`)

| Case family | Proof |
|---|---|
| Registry entries, revisions, grants | Throwing Proxy AND getter tails past the 64-object cap are never read (`touched() === false`, `BUDGET_EXCEEDED`) |
| Nested sections | 48 valid sections pass at exactly 64 charges; a structurally poisoned 50th entry refuses `BUDGET_EXCEEDED` with empty `excluded_ids` (never validated) |
| Nested assertions | Same pair: 48 pass, poisoned 50th refuses with empty `excluded_assertions` |
| Trusted context (#632) | Trusted fillers share the budget; oversized trusted revision charged |
| Object / payload / span | Exact-limit/+1 through `run()` (48/49 sections, 48/49 assertions; payload via the 300 KiB trusted revision) |
| Output bytes | Exact limit passes at 262,143 bytes; one more quoted byte (262,145) refuses `OUTPUT_LIMIT` |
| Output records | The records gate is unreachable through `run()` — see below |

## Two findings the contract documents (observed, not changed)

**Live tails can only arrive via live context objects.** The task and the
document set both pass through JSON, and the JSON round-trip strips
getters and Proxies — a throwing tail cannot survive it. So for nested
families (sections/markers/references/assertions) the sentinel proof is
a STRUCTURAL poison (an entry invalid on its face past the cap), not a
live tail. If a nested entry were ever validated, it would land in
`excluded_*` as malformed and the run would NOT refuse — so
`REFUSED` + `BUDGET_EXCEEDED` with empty `excluded_*` proves it was
never inspected. The code shape is identical for all nested families
(`countObject()` as the first statement of each loop iteration in
`validateDocument` / the assertions loop).

**Output records are unreachable through `run()`; output bytes are the
binding output gate.** Every output record traces to a charged candidate
(one inventory item per charged document, one edge per charged
reference, one `source_ref` per charged resolution), so the record count
of the maximal passing bundle stays far under the 256-record cap while
objects are already at 64 — growth stops at the object budget first
(proven: the 49-valid-section bundle refuses `BUDGET_EXCEEDED`). Output
BYTES are reachable because a citation carries each quoted byte twice
(`quoted_span` AND `span.quoted_text`): the largest passing envelope is
262,143 bytes (odd parity) and one more quoted byte refuses. Context
payload bytes are charged twice (once at admission in `validateContext`,
once at resolution) — an observed property the output cases depend on,
not a change proposed here.

## Copy/adapt guide (per agent)

1. Copy `sentinel-fixtures.js` and the test file into the agent's own
   `tests/` (or import the helpers and adapt the builders).
2. Replace the Document Agent builders (`withCustomSet`, `nominalDoc`,
   `buildOutputCase`) with the agent's own task/context builders and
   its own public `run()` path. Keep the tail helpers and the
   `touched() === false` assertions verbatim.
3. Re-derive the exact-boundary arithmetic for that agent's own budget
   (its base charge count, its per-family charge order) — do NOT reuse
   the Document Agent's 48/49 numbers blindly. The README of the
   adopting agent records the arithmetic.
4. File the adoption under the agent's own authenticated manifest for
   separate review (condition 5).

## Adoption

| Agent | Status |
|---|---|
| Document Agent (#633) | Demonstrated in this PR (all contract tests through its public `run()`) |
| Financial Manager (#626) | Copy/adapt owed — separately reviewed |
| Customer Success (#632) | Copy/adapt owed — separately reviewed (its CS-001 tests already cover the trusted-sources poison; the getter-tail + exact-boundary pairs are the gap) |
| All other Phase 2 agents | Copy/adapt owed as each reaches review |
