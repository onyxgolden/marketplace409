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
  bundle's host-registered dataset identity.

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
- 256 KiB aggregate input (one invocation-wide budget: serialized task +
  every consulted metadata string + selected source bytes — no separate
  allowances), 256 KiB output envelope, depth 32, 5-second watchdog
- Every candidate is charged **before** its fields are inspected; the 65th
  candidate and 513th span are refused without traversal (sentinels prove it).
- Record slots are charged before parsing: an over-budget candidate with
  malformed JSON refuses `BUDGET_EXCEEDED`, never `INVALID_INPUT`.
- Admission order: trap-free Proxy rejection → task → context control plane
  (the sources container is charged but never walked) → principal role AND
  validity window → per-ref grant check → that source entry only.
- Proxies are rejected by the native trap-free check (`node:util`
  `types.isProxy`) before any reflection: zero trap invocations.

## Output-record taxonomy (one bounded final-envelope walk)

Each emitted occurrence counts once toward the 256-record cap:

- one per `source_refs[]`, `diagnostics[]`, `quarantined_sources[]` entry;
- one per `classifications[]` and `drafts[]` entry;
- one per citation and one per span nested inside a classification/draft;
- one per `metrics[]` occurrence — including the aliased copy inside
  `summary.metrics`;
- one per nested `stage_ages[]` entry;
- one for `header_comparison`, one for `population`, one for `summary`
  (when present).

Scalars and plain collection arrays are not records; discarded intermediate
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
```

Trust: `bootstrap.mjs` is the host-pinned trust anchor (its sha256 is
published in the review request; the host verifies it with
`sha256sum bootstrap.mjs` before running). It recomputes the full corpus
digest from `corpus/manifest.json` with Node builtins only — manifest root
first, then every transitive file, rejecting unlisted files, symlinks, and
unsupported executable extensions — and refuses (exit 3) on mismatch BEFORE
importing any candidate code. `npm test` / `npm run battery` go through it.
