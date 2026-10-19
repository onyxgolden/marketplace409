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
   half-away-from-zero, after summing), win rate (undefined unless closed
   outcomes exist in the interval), stage age in elapsed UTC minutes.
   Currencies are never mixed; missing probabilities never become zero.
5. Compares optional header claims; any mismatch suppresses the summary and
   keeps the comparison evidence.

## Candidate taxonomy

| Kind | Meaning |
|---|---|
| Lead record | One per-candidate fixture record, charged before its fields are read |
| Criteria entry | Allowlisted product/benefit tokens; each charged before its code is read |
| Span | One raw per-element span from the structural splitter; charged before decode |

## Budget (per task)

- 64 consulted objects, 512 checked spans, 256 output records
- 256 KiB aggregate input, 256 KiB output envelope, depth 32, 5-second watchdog
- Every candidate is charged **before** its fields are inspected; sentinels
  prove the 65th candidate and 513th span are refused without traversal.

## Fit classification precedence

1. `need_match=false` OR `budget_match=false` → `FIT_LOW`
2. Any required fact missing (`null`) → `FIT_UNKNOWN` with the gaps listed
3. Both true AND `timing_days ≤ fit_high_timing_days` (default 90) → `FIT_HIGH`
4. Otherwise → `FIT_MEDIUM`

`do_not_contact` is a validated boolean, never defaulted.

## Refusal vocabulary

- `REFUSED / INVALID_INPUT` — malformed task, context, or lead record
- `REFUSED / DUPLICATE_ID` — duplicate lead or opportunity identity
- `REFUSED / BUDGET_EXCEEDED` — object/span cap tripped (charged before read)
- `REFUSED / INPUT_LIMIT` — payload over 256 KiB
- `REFUSED / OUTPUT_LIMIT` — output records over 256
- `REFUSED / HASH_MISMATCH` — fixture bytes fail Git-blob verification
- `REFUSED / SOURCE_UNVERIFIED` — revision label or commit not registered
- `REFUSED / ACTION_DENIED` — no read grant for the requested repo+path
- Non-READY statuses: `REPORT_READY`, `PARTIAL` (quarantines or unverifiable
  fields present), `REFUSED`, `EMPTY` (no admitted records)

## Running

```bash
# The approval root is a host input, never a package script.
export SALES_APPROVED_ROOT="$(cat corpus/corpus_digest.txt)"
npm test        # unit tests (trust authentication first)
npm run battery # 120-case battery (trust authentication first)
```

Trust: both entrypoints recompute the full corpus digest from `corpus/manifest.json`
with Node builtins only and refuse (exit 3) on mismatch before any scored code runs.
