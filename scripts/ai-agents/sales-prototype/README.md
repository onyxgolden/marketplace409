# Sales Agent Phase 2 — Slice 1 Synthetic Prototype

A deterministic, offline, fixture-only prototype of the Sales Agent's lead
classification, `do_not_contact` suppression, inert outreach-draft generation,
and pipeline-health arithmetic. Pure Node 24 ESM, zero runtime dependencies,
no network, no CRM access, no real prospect data.

## What it does

Given a validated task (fixture references + options) and a host-provided
context (clock, sources, grants, principal, criteria, product registry), it:

1. Classifies each invented lead's fit: `FIT_HIGH` / `FIT_MEDIUM` / `FIT_LOW` / `FIT_UNKNOWN`.
2. Suppresses **all** draft output for `do_not_contact=true` leads — checked
   before any draft is constructed. Suppression yields zero variants, even for
   high-fit, injected, or purportedly-authorized leads.
3. Builds at most two inert outreach templates (introduction, clarification)
   per *eligible* lead — `FIT_HIGH`, verified fixture product, no quarantine.
   Templates are plain-text, marked `DRAFT — NOT SENT`, and may carry only
   allowlisted product/benefit tokens. No discounts, commitments, deadlines,
   or contact details. No outbound action exists anywhere in this package.
4. Computes pipeline-health metrics per currency with exact
   BigInt/integer-rational arithmetic: open gross, weighted open (rounded once,
   half-away-from-zero, after summing), win rate (undefined only for a verified
   empty closed set; missing closed_at on a closed row makes the metric
   unverifiable), stage age in elapsed UTC minutes. Currencies are never
   mixed; missing probabilities never become zero.
5. Compares optional header claims against exact recomputation; any mismatch —
   or a header whose interval does not describe the task's report period —
   suppresses the summary and keeps the comparison evidence.

Every classification and draft carries a byte-exact citation: the source
bundle's byte range (`start_byte`/`end_byte` half-open UTF-8 offsets), the
quoted record text, and a verification record proving the slice round-trips
byte-identically. Product/benefit tokens are explicitly marked as coming from
the separately trusted host context, not from source bytes.

## Population completeness (trusted, applicable)

A definitive summary (`report.summary`, `complete:true`) requires ALL of:

- the caller declared `population.declared_complete: true`;
- the host's registered `expected_records` matches the admitted spans on
  EVERY bundle (host-established coverage);
- the caller's `expected_lead_ids` / `expected_count` claims match;
- the declared `dataset_id` / `dataset_version` binds to every resolved
  bundle's host-registered dataset identity;
- the task's report interval falls inside the host-registered `coverage`
  interval (`interval_start`..`interval_end`) on EVERY bundle (S653-001:
  caller-selected periods cannot supply their own coverage).

A matching caller claim alone never establishes coverage. Missing,
contradictory, or unknown coverage suppresses the summary and `complete:true`;
the recomputed metrics remain available as clearly partial results. Verified
zero (empty bundle, bound identity) is distinct from unknown empty.

## Candidate taxonomy

| Kind | Meaning |
|---|---|
| Task / context object | Every object in the task and the context control plane, charged before its fields are read |
| Source entry | One granted source entry + its revisions container + the selected revision |
| Lead record slot | One per bundle record, charged BEFORE JSON.parse decodes it |
| Criteria / product entry | Each registry/criteria object, charged before its fields are read |
| Reference-list entry | Each `expected_lead_ids` primitive, charged as a consultation (bound: 4096) |
| Span | One raw per-element span from the structural splitter, charged before decode; one citation span-check per record |

## Budget (per task)

- 64 consulted objects, 512 checked spans, 256 output records
- 256 KiB aggregate input (one invocation-wide budget: the single
  nonduplicating serialized UTF-8 representation of task + context control
  values + revision metadata, plus the once-charged selected source bytes —
  no separate allowances, no double-counting), 256 KiB output envelope,
  depth 32, 5-second watchdog
- Every candidate is charged **before** its fields are inspected; the 65th
  object and 513th span are refused without traversal (sentinels prove it).
- Record slots are charged before parsing: an over-budget candidate with
  malformed JSON refuses `BUDGET_EXCEEDED`, never `INVALID_INPUT`.
- Byte accounting uses the canonical serialized form (structure, quoting,
  escaping included): `serializedByteLength` === `canonicalByteLength` on
  plain data; NUL/quote/backslash/Unicode escapes are charged, never
  bypassed.
- Admission order: trap-free Proxy rejection → task → context control plane
  (the sources container is charged but never walked) → principal role AND
  validity window → per-ref grant check → that source entry only.
- Proxies are rejected by the native trap-free check (`node:util`
  `types.isProxy`) before any reflection: zero trap invocations.
- Inherited getters never execute: every admission level requires a plain
  prototype (`Object.prototype` or `null`) and reads through own data
  descriptors only.

## Output-record taxonomy (one bounded complete-envelope walk)

S653-007: a genuinely recursive, bounded walk over the final public
envelope. Every object occurrence counts — no shared-identity dedup, no
schema-specific field list. The outer envelope shell is the transport
container (not counted); everything inside it counts: `source_refs`,
`diagnostics`, `quarantined_sources`, `report`, `population`, `summary`
(and its aliased metrics), each classification/draft, each nested citation,
span, source_ref, verification, criteria_evidence, product_evidence,
metrics group, calculation_basis, and stage_age. Arrays are transparent
(walked into, not counted); scalars are not records; discarded intermediate
work is never counted. Overrun returns bounded `REFUSED`, `complete:false`,
`report:null` — no partial domain artifact.

## Fit classification precedence

1. `need_match=false` OR `budget_match=false` → `FIT_LOW`
2. Any required fact missing (`null`) → `FIT_UNKNOWN` with the gaps listed
3. Both true AND `timing_days ≤ fit_high_timing_days` (default 90) → `FIT_HIGH`
4. Otherwise → `FIT_MEDIUM`

`do_not_contact` is a validated boolean, never defaulted.

## Time treatment

- Report-interval endpoints and `closed_at` compare as normalized full UTC
  instants — never ten-character date slices. Date-only endpoints use the
  inclusive civil-date treatment: start at 00:00:00Z, end at 23:59:59Z.
- A reversed report interval is `INVALID_INPUT`.
- Win rate counts closes whose instant falls inside the interval. A closed
  row without `closed_at` is missing outcome evidence → the metric is
  unverifiable (not a verified empty denominator). An open-stage row
  carrying `closed_at` is inconsistent → unverifiable.
- Principal authorization windows are enforced against the injected host
  clock (inclusive). Expired, future, or inverted windows are `ACTION_DENIED`
  before any source entry is admitted.

## Refusal vocabulary

- `REFUSED / INVALID_INPUT` — malformed task, context, lead record, or proxy input
- `REFUSED / DUPLICATE_ID` — duplicate lead or opportunity identity
- `REFUSED / BUDGET_EXCEEDED` — object/span cap tripped (charged before read)
- `REFUSED / INPUT_LIMIT` — payload over 256 KiB
- `REFUSED / OUTPUT_LIMIT` — output records over 256 (final-envelope walk)
- `REFUSED / HASH_MISMATCH` — fixture bytes fail Git-blob verification
- `REFUSED / SOURCE_UNVERIFIED` — revision label or commit not registered
- `REFUSED / ACTION_DENIED` — no read grant; unauthorized role; dead principal window
- `REFUSED / TRANSPORT_REFUSED` — guarded transport admission failure
- `REFUSED / WORKER_ERROR` / `EXECUTION_TIMEOUT` — guarded execution failures
- Every refusal carries `report:null`. Non-READY statuses: `REPORT_READY`,
  `PARTIAL` (quarantines, unverifiable fields, or unknown coverage),
  `REFUSED`, `EMPTY` (no admitted records)

## Running

```bash
# The approval root is a host input, never a package script.
export SALES_APPROVED_ROOT="$(cat corpus/corpus_digest.txt)"
npm test        # unit tests (trust authentication first)
npm run battery # 120-case battery (trust authentication first)
node bootstrap.mjs manual [bundle] [outdir]  # manual run via the pinned bootstrap
```

Trust: `bootstrap.mjs` is the host-pinned trust anchor (its sha256 is
published in the review request; the host verifies it with
`sha256sum bootstrap.mjs` before running). It authenticates the manifest
ROOT digest FIRST — before consulting any member path — then every
transitive file (regular files only: symlinks, FIFOs, sockets, and devices
are rejected without being opened; per-file size cap), rejecting unlisted
files and unsupported executable extensions, and refuses (exit 3) on
mismatch BEFORE importing any candidate code. `npm test` /
`npm run battery` go through it, as does manual execution:
`node bootstrap.mjs manual [bundle] [outdir]` (never a self-authenticating
candidate entrypoint).

Guarded execution: `runGuarded()` always constructs the single fixed
production worker (`runner/guarded-worker.js`); there is no
caller-selectable worker path. Hang coverage uses the closed test-only
identity `runGuardedWithTestWorker(..., "hang")` — unknown names refuse.
Worker results are shape-checked before acceptance.
