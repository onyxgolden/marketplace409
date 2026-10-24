# PR #670 fix round 2 — build report (P670-005A)

Date: 2026-10-23 (America/Chicago)
PR: onyxgolden/marketplace409 #670 — AI Lab P2a-2 Maintenance Manager wiring
Branch: `feat/ai-lab-p2a2-maintenance-manager-wiring`
Base head (reviewed, NEEDS CHANGES on P670-005A only): `1be5e0bb75fec49dfdf7646951f2acd7f1af79f3`
Fix commit: local `21bc6842` on top of the tree-identical local base `f99218d2`
(tree `150ff233` == the reviewed head's tree), fix tree `176c6af0`; pushed via the
stacked API route (see the push receipt under `~/workspace/push-receipts/`).

Scope: ONLY P670-005A. P670-001..004 and CP9 closures are untouched — no hunk in
this round modifies their code paths. Both jobs remain DISABLED,
`execution_authorized:false`, WIRED_INERT. No merge, no deploy, no activation.

Binding spec: ChatGPT's re-review
(`results/chatgpt/pr670-p2a2-fix-round-rereview-2026-10-23.md`) and the local
panel verdict (`results/muse/pr670-fix-round-local-panel-review-2026-10-23.md`),
which converge on the residual: the PM per-citation identity appends `charge_ref`
by raw colon concatenation, so (schedule "a:b", charge "c") and (schedule "a",
charge "b:c") mint the same row_id `int:SCHEDULE_LEASE_MISMATCH:schedules:a:b:c`,
and the serializer's duplicate protection throws a plain Error that escapes
`runJob` uncaught — the whole job rejects, nothing publishes.

## Reproduction (at base head `1be5e0bb`, before the fix)

ChatGPT's filed reproducer
(`results/chatgpt/pr670-fix-round-reviewer-collision-probe-2026-10-23.mjs`) run
verbatim against the pre-fix tree (log:
`~/workspace/p670-fix2-evidence/repro-at-1be5e0bb.log`):

- `COLON_COLLISION` → **threw** `reportRowIds: duplicate public row identity
  'int:SCHEDULE_LEASE_MISMATCH:schedules:a:b:c'`, **items: 0**.
- `ONE_PAIR_CONTROL` → COMPLETED, identity `int:SCHEDULE_LEASE_MISMATCH:schedules:a:b:c`.
- `DISTINCT_PAIR_CONTROL` → COMPLETED, two identities.

## Fix 1 — injective identity encoding (`propertyManagerJob.js`, pushIntegrity)

When a per-citation discriminator (`identityRef`) is appended, BOTH free-form
components are now length-framed:

```
int:<kind>:<dataset>:<len(record_ref)>:<record_ref>:<len(identityRef)>:<identityRef>
```

e.g. the counterexample pair now mints
`int:SCHEDULE_LEASE_MISMATCH:schedules:3:a:b:1:c` and
`int:SCHEDULE_LEASE_MISMATCH:schedules:1:a:3:b:c` — distinct.

Why this is injective: kind and dataset are colon-free code vocabularies
(call-site literals / the DATASETS list), so the fixed prefix boundary is
unambiguous; from that known offset the framed tail parses uniquely (decimal
length, colon, exactly that many characters, colon, decimal length, colon,
exactly that many characters, end). Framing only ONE component is NOT
injective (a framed-looking segment inside the raw component admits a second
parse) — that is why both components are framed. Length framing was chosen
over a canonical-JSON tail (keeps the colon-grammar shape the renderer and
decision validator treat as an opaque string) and over a digest (keeps the
identity human-readable for review). Without a discriminator the identity
keeps the exact P670-005 form `int:<kind>:<dataset>:<record_ref>`:
record_ref is the final component there, so its content can never alias a
further component — that form was already injective and is unchanged.

Nothing parses row_ids anywhere in the surface (grep-verified: no `split(":")`
over identities); `decisionValidator` binds decisions by opaque full-string
membership in `item.row_ids`, so renderer/decision compatibility is preserved.

## Fix 2 — bounded named refusal (`privateItemSerializer.js`, reportRowIds)

The duplicate-identity guard still refuses (collision detection kept as
defense in depth; the same-row-two-sections sharing is unchanged), but it now
throws `JobRefusal("DUPLICATE_ROW_IDENTITY", …)` instead of a plain `Error`.
The runner's existing error boundary maps `JobRefusal` to a bounded
`REFUSED` outcome with the code — an unexpected serializer identity failure
can no longer escape the job envelope as an uncaught rejection, and nothing
publishes (serialization precedes publication). The refusal detail retains
the phrase "duplicate public row identity", so the pre-existing frozen
assertion on the refusal text still matches.

## Sweep — every identity-construction site checked

Grep family: template-literal colon compositions, `join(":")`/concatenation
patterns, and `row_id`/`item_id` construction across
`src/application/ai-lab/rental-ops/` and `scripts/ai-agents/rental-ops-wiring/`
(src, batteries, tests reviewed separately):

| Site | Verdict |
| --- | --- |
| PM `pushIntegrity` + `identityRef` (SCHEDULE_LEASE_MISMATCH) | **THE DEFECT — fixed (Fix 1).** The only site composing TWO free-form components. |
| PM `pushIntegrity` base form (all other kinds, incl. DUPLICATE_CONFLICT / coverage rows fed from snapshot conflicts/gaps) | Not a defect. kind = call-site literal; dataset originates from snapshotBuilder's fixed DATASETS loop; record_ref is the final component → injective. Unchanged. |
| MM `pushIntegrity` (`maintenanceManagerJob.js`) | Not a defect. Same 3-component form; MM has no discriminator append anywhere. Unchanged. |
| PM `exp:<lease_ref>`, PM `ovd:<lease_ref>`, MM `wo:<ref>` | Not defects. Single free-form component after a fixed prefix; distinct refs give distinct ids. Unchanged. |
| PM `esc:<row_id>:<touchpoint>` (escalation_id) | Not a defect. touchpoint ∈ the fixed policy vocabulary (`tenant`/`legal`/`money`, colon-free code constants), so the tail segment is unambiguous; escalation_id is derived/display — decisions bind `row_id`, not escalation_id. Unchanged. |
| Serializer item identity (`pm-`/`mm-` + sha256 of canonical JSON tuple) | Not a defect. Injective by construction (canonical tuple digest). Unchanged. |
| Battery oracles (`battery/oracle.js`, `battery-mm/oracle-mm.js`) | Not sites. They construct no row identities (kinds/totals/status only). Unchanged. |
| snapshotBuilder conflicts/coverage | Not a site. Produces (dataset, record_ref) pairs consumed by pushIntegrity; builds no identity strings. Unchanged. |
| Error-message compositions (`BUDGET_EXCEEDED:<kind>`, JobRefusal `code:detail`, `POLICY_UNKNOWN:<list>`) and `canonical.js` | Not identities (canonical JSON is injective by construction). Unchecked as identity sites by design; listed for completeness. |

## Frozen regressions added

- Vitest `propertyManagerJob.test.js`, new describe
  "per-citation identity injectivity (P670-005A)":
  - ChatGPT's exact pair through the full snapshot path → the two distinct
    framed identities above; `serializePrivateItem` succeeds; both ids in
    `item.row_ids`.
  - Adversarial batch driven directly at the evaluator (snapshot admission
    drops empty refs upstream; injectivity is an evaluator property): 8
    (schedule, charge) pairs whose raw concatenations alias pairwise —
    ("a:b","c")/("a","b:c"), ("x:","y")/("x",":y"), ("","a:b")/(":a","b"),
    (":","")/("",":") — mint 8 distinct framed identities and serialize
    without throwing.
  - Serializer-hardening describe gains an assertion that the
    duplicate-identity refusal is a `JobRefusal` with code
    `DUPLICATE_ROW_IDENTITY` (typed, named), not a plain Error.
- Wiring `tests/runner.test.js`, new test "P670-005A: colon-collision
  schedule/charge pairs publish two distinct, independently decidable
  identities": ChatGPT's public-run counterexample through `runJob` —
  colliding pair COMPLETED with 1 store write and the two distinct
  identities, `validateDecision` accepts an independent decision on EACH
  row; single-pair control (one identity); distinct-pair control
  (charge_ref "different" → `int:SCHEDULE_LEASE_MISMATCH:schedules:1:a:9:different`).

## Disclosed expectation changes (complete list)

1. Six frozen identity strings in `propertyManagerJob.test.js` (the round-1
   P670-005 discriminator expectations) re-frozen in framed form — the ONLY
   changed expectations anywhere:
   `…:schedules:sch-1:ch-2` → `…:schedules:5:sch-1:4:ch-2`;
   `…:sch-1:ch-3` → `…:5:sch-1:4:ch-3`;
   `…:sch-1:ch-2a` → `…:5:sch-1:5:ch-2a`;
   `…:sch-1:ch-2b` → `…:5:sch-1:5:ch-2b` (each `int:SCHEDULE_LEASE_MISMATCH` prefixed).
   Reason: the encoding itself is the fix; every SCHEDULE_LEASE_MISMATCH row
   carries the discriminator, so every such identity is framed.
2. `scripts/ai-agents/rental-ops-wiring/runner/manifest.json` re-pinned via
   `runner/make-manifest.mjs` (39 files) — required after any closure source
   change. Host trust root moved
   `ba99142e30aaf75a22801e91810a5514a1ae9b3cdaa267622e70db79115d5549` →
   `abb1eaf9da9f01dba7373ef99bf19eeea1cd32d43f7d35c83044f6e4500054bb`.
3. Battery manifests (`battery/manifest.json`, `battery-mm/manifest-mm.json`)
   UNCHANGED — no battery file changed. The batteries pin kinds/totals/status
   plus across-run byte identity, never row_id strings, and the PM battery's
   cases contain no expectation over mismatch identities.
4. `budgets.js` UNTOUCHED; caps unchanged (64 candidates / 256 output
   records); no battery case recalibrated — item record counts do not change
   (same rows, differently-encoded ids).

## Evidence (logs in `~/workspace/p670-fix2-evidence/`)

- Rental-ops vitest, identical command both sides, CI JSON reporter:
  base (pre-fix tree) **106/106 tests, 25/25 suites, 0 failed** — matches the
  panel chair's verified base; head **109/109 tests, 26/26 suites, 0 failed**.
  Delta = exactly the +3 new tests / +1 new describe. ESLint clean on all
  changed files.
- ChatGPT's probe re-run against the fixed tree
  (`probe-after-fix.log`): COLON_COLLISION → COMPLETED, items 1, identities
  `[…:1:a:3:b:c, …:3:a:b:1:c]`; both controls exact.
- Wiring node:test suite via the host trusted launcher
  (`RENTAL_OPS_TRUST_ROOT=abb1eaf9…`): **62/62 pass, 0 fail** (61 at base +
  the 1 new frozen P670-005A test), exit 0 — the wall-clock deadline test
  passed in-suite this run.
- PM battery via trust entry: **PASS — 80 cases** {domain 20, coverage 20,
  scope 20, budget 20}, 3 external invocations, each case 3 runs
  byte-identical against the (unchanged) oracle.
- MM battery via trust entry: **PASS — 80 cases**, same protocol, 3 external
  invocations. (The third invocation's first attempt died silently inside
  the exec harness — log with no verdict line; it was re-run standalone and
  passed cleanly, exit 0. Stated plainly rather than papered over.)

Files changed (5): `propertyManagerJob.js`, `privateItemSerializer.js`,
`propertyManagerJob.test.js` (src rental-ops); `tests/runner.test.js`,
`runner/manifest.json` (wiring). Plus this report copy
(`docs/pr670-fix-round2-build-report-2026-10-23.md`).
