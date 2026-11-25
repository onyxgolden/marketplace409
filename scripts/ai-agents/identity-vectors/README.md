# Unambiguous operation-identity fixture vectors

`FORGE-P-20261021-CHATGPT-IDENTITY-TUPLE-VECTORS` (ChatGPT, 2026-10-21;
bundle row 15). Three-agent agreement 2026-10-22: ChatGPT **AGREE** (Muse
conditions 1–4 + Claude condition 5 adopted in full); Muse **AGREE WITH
CONDITIONS**; Claude **AGREE WITH CONDITIONS**. Reaffirmed 10-24 / 10-27;
Oct 30 bundle review row 15: **AGREE**. Jason triaged Nov 22 (build rows
1, 3–28).

## Why this pack exists

Team Brain #636: retention keys joined with colons collapsed distinct
attribution — and even distinct obligations — into a false successful
replay. The reviewed fix needs reusable collision cases. Vector V-15 is
that failure in miniature: obligation `obl-1` with actor `actor-A:x`
and obligation `obl-1:actor-A` with actor `x` encode to the identical
colon-joined string, so the second operation replays as if it were the
first.

## What this is

A synthetic vector/documentation pack plus a small harness, following
the budget-sentinel pack binding (row 4, `scripts/ai-agents/
budget-sentinels/`):

- `identity-vectors.js` — the pack: 16 key vectors (`KEY_VECTORS`), 6
  ledger scenarios (`LEDGER_SCENARIOS`), the `checkEncoder` /
  `checkLedger` harness, a fixture-only in-memory `OperationLedger`,
  and the two sample encoders.
- `tests/identity-vectors.test.js` — 15 contract tests through the
  pack's public entrypoints. Run with `node tests/run-tests.js` (or
  `npm test` in this directory).
- `tests/run-tests.js` — plain `node --test` entrypoint.
- `package.json` — `"type": "module"`, no dependencies.

Doc + fixtures only. **No shared runtime encoder, no encoding standard,
no migration, no activation, no live data, no spend.** Each adopting
module copies/adapts this pack into its own harness and never imports
it at runtime.

## The five adopted conditions (all represented)

1. **Synthetic only** — no real actor/tenant identifiers in the vector
   tuples (actors are `actor-X`, obligations `obl-X1`, …). Enforced by a
   pack-hygiene test that rejects `@`, personal names, and any field
   outside the declared bound set.
2. **Doc + fixtures only** — no shared production encoder dependency.
   The two sample encoders live in the pack for demonstration; adopting
   modules copy/adapt, never import at runtime.
3. **The pack tests identity, never sets the standard** —
   delimiter-escaping vs length-prefix vs structured encoding stays a
   per-module, reviewer-adjudicated decision, and each adoption is
   separately reviewed. The length-prefix encoder is *an* encoder that
   passes, not *the* encoding.
4. **The motivating case is explicit** — V-15 is the cross-obligation
   replay from #636, plus the deliberately-ambiguous-encoder negative
   (the colon-join encoder, which must fail V-01/V-02/V-03/V-04/V-15/
   V-16) and the valid positive control (V-13 exact retry, so the pack
   cannot degenerate into refusing everything).
5. **Tampered stored binding + JSON-hostile content (Claude)** —
   L-04a/L-04b: an admin directly mutates one bound field on an
   already-stored event; replay of the original call must refuse, not
   silently match. L-04b's mutation is chosen so the colon-joined key
   is byte-identical after the mutation — only the payload hash can see
   it. V-05/V-06/V-07 cover quotes, backslash/colons, and newlines.

## Vectors

| ID | Category | Expect | Catches |
|----|----------|--------|---------|
| V-01 | delimiter-collision | DISTINCT | colon in actor + colon in reason re-split the join |
| V-02 | delimiter-collision | DISTINCT | obligation/actor boundary moves |
| V-03 | empty-absent | DISTINCT | empty reason vs absent reason |
| V-04 | empty-absent | DISTINCT | empty actor vs absent actor |
| V-05 | json-hostile | DISTINCT | quote-stripping encoders |
| V-06 | json-hostile | DISTINCT | newline-stripping encoders |
| V-07 | json-hostile | DISTINCT | backslash-as-escape without matching encode |
| V-08 | unicode | DISTINCT | lossy non-ASCII folding |
| V-09 | unicode | DISTINCT | Unicode normalisation (see adaptation note) |
| V-10 | binding | DISTINCT | dropped repo binding |
| V-11 | binding | DISTINCT | dropped head binding |
| V-12 | binding | DISTINCT | dropped path binding |
| V-13 | exact-retry | SAME | positive control — identical tuples share a key |
| V-14 | changed-payload | DISTINCT | dropped payload field |
| V-15 | cross-obligation | DISTINCT | **the #636 failure** |
| V-16 | delimiter-collision | DISTINCT | kind/repo boundary moves |

Ledger scenarios (through `OperationLedger`, outcomes INSERTED /
DUPLICATE / CONFLICT / TAMPERED_BINDING, monotonic event versions):

| ID | Scenario |
|----|----------|
| L-01 | Exact retry resolves to the original event version (v1), no new event |
| L-02 | Changed payload under the same key is CONFLICT, refused |
| L-03 | Cross-obligation replay never falsely succeeds (distinct key inserts; colliding key is CONFLICT, never DUPLICATE) |
| L-04a | Plain tampered stored binding refused |
| L-04b | Key-preserving tampered stored binding refused (payload-hash detection) |
| L-05 | Replay resolves to the original version, not the latest |

## How to adopt (copy/adapt — never import at runtime)

1. Copy `identity-vectors.js` (or the vectors you need) into your
   module's own test harness.
2. Map your public entrypoint's fields onto the bound field set
   (`obligation, actor, reason, recordedAt, kind, repo, path, head,
   state, owner, evidence`). Drop vectors for fields your module does
   not bind — and document the dropped binding in your adoption review.
   V-09 is the documented example: a module with an explicit, reviewed
   Unicode-normalisation policy adapts V-09 to SAME and records the
   policy; the default expectation is DISTINCT.
3. Call `checkEncoder(yourEncoder)` and `checkLedger(yourEncoder)`.
   A correct encoder passes every key vector and every ledger scenario.
4. Each adoption is separately reviewed. Passing this pack does not
   certify an encoding standard and confers no merge/activation
   authority.

## Verified results (this PR, base `05138d86`)

- New suite: **15/15 pass** (`node tests/run-tests.js`, also `npm test`).
- Length-prefix encoder: **16/16 key vectors**, **6/6 ledger
  scenarios**.
- Colon-join encoder: fails exactly **V-01, V-02, V-03, V-04, V-15,
  V-16** (delimiter collisions + empty-vs-absent collapse) with
  byte-identical keys on each; passes all 6 ledger scenarios — the
  ledger refuses the collision (CONFLICT), it never falsely succeeds
  (DUPLICATE). L-03 is the observable difference: the colliding second
  operation is refused under the colon join and inserts under
  length-prefix.
- Non-vacuity: a constant encoder and an empty-string encoder each
  pass only V-13 (1/16) — the pack cannot pass a degenerate encoder.
- Two real bugs caught by the tests during the build, both fixed with
  the tests as the proof: (1) the ledger's tamper check recomputed the
  encoder key even for caller-supplied explicit keys, falsely flagging
  L-02 as tampered — the check now recomputes only for derived keys;
  (2) V-16's original construction used non-adjacent fields (reason
  and kind have `recordedAt` between them), so the colon join did not
  actually collide — rebuilt on the adjacent kind/repo boundary.

## What was deliberately NOT built

No shared runtime encoder (nothing in this pack is importable by
production code by design — adopting modules copy it); no encoding
standard; no change to the Team Brain retention code or any other
runtime module; no migration; no CI gate or scheduler; no live data.
Adoption into Team Brain's retention keys is a separately reviewed
step, not part of this PR.

## Related in-tree encoding (observation, not a finding)

`scripts/team-brain/transport/gitShadowImporter.mjs` (`makeFrontier`)
also joins fields with colons — but its fields are a version tag,
commit SHAs, a hex scope hash, and small integers, so the delimiter
class does not apply the same way. It is out of scope for this pack;
listed only so an adopter checking for in-tree colon joins finds it.
