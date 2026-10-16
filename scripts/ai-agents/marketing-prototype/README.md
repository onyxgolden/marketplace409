# Marketing agent — Phase 2 slice 1 prototype

Deterministic, bounded **synthetic campaign classifier + funnel-metrics
recomputer + inert draft renderer**. Given pinned fixture bytes (registered
campaigns, event rows or aggregate-count rows, campaign-to-event bindings,
reporting period, header claims, content briefs, completeness declarations),
it produces an advisory report: campaign classification, exact funnel
metrics, pooled rates, header-claim comparisons, duplicate groups,
exclusions, coverage, and up to 3 inert `DRAFT — NOT PUBLISHED` content
variants per brief. Advisory only — it never publishes, sends, spends,
targets, or activates anything.

## Layout

- `src/index.js` — `run(task, context)` entry; common advisory envelope
- `src/schemas.js` — strict runtime schemas (unknown props rejected, pins are 40-hex, closed enums)
- `src/budget.js` — monotonic budget + structural pre-splitter (charge-before-inspect, depth ≤ 32)
- `src/resolver.js` — scoped fixture resolution with Git blob SHA-1 pin verification
- `src/rational.js` — exact BigInt rational arithmetic; half-away-from-zero display
- `src/metrics.js` — classification, event validation, conversion dedup, attribution, metrics, pooling, header comparison
- `src/drafts.js` — inert template rendering (length in codepoints, never truncated)
- `src/injection.js` — seeded injection-family recognizer (classifier only, not a boundary)
- `src/canonical.js` — canonical JSON + SHA-256 + Git blob SHA-1
- `src/markdown.js` — optional Markdown renderer (consumes the JSON, invents nothing)
- `fixtures/` — host-pinned taxonomy v1 (tags, 3 templates, CTA registry), benefit registry, authority table doc
- `corpus/battery.json` — 120 frozen cases with independently derived expectations
- `corpus/oracle.js` — independent re-derivation of the rules (imports nothing from `src/`; authoring only)
- `corpus/make-battery.js` — battery authoring tool
- `corpus/manifest.json` + `corpus/corpus_digest.txt` — pinned file hashes + digest
- `runner/run-manual.js` — standalone manual runner (`node runner/run-manual.js <task.json> <context.json> [md]`)
- `tests/` — battery, determinism, schemas, rational, budgets, injection, drafts, metrics, mutation, watchdog, zero-tool tests

## Usage

```bash
# Official invocations — DIRECT node, never via npm. `npm test` / `npm run battery`
# must never be used: npm executes candidate lifecycle scripts (pretest/posttest)
# before trust authentication. Direct invocation guarantees the builtins-only
# authenticator runs first.
MK_APPROVED_ROOT=<digest-from-corpus-digest.txt> node tests/run-tests.js     # unit suites (trust-authenticated)
MK_APPROVED_ROOT=<digest-from-corpus-digest.txt> node tests/run-battery.js  # 120-case acceptance battery (trust-authenticated)
node runner/run-manual.js <task.json> <context.json> md
```

The approved root is a separately trusted host input (env), never
self-supplied by package.json. Both entrypoints authenticate the full
corpus digest with node builtins before importing any scored code.

## Behavior summary

- Input: `{schema_version:"1", task_id, operation:"analyze", fixture_refs:[{fixture_id, kind}], options:{period, mode, include_drafts, draft_max_codepoints, pool_groups}}`. Only `analyze` is supported; `publish`/`send`/`spend`/… → `REFUSED`/`ACTION_DENIED`; anything else → `UNSUPPORTED_TASK`.
- Authority: `context.principal` must be Jason (`{kind:"jason"}`) or a registered, unrevoked, currently-valid Muse relay from the host table; anything else → `AUTH_UNVERIFIED`. Task prose, hashes and "approved" strings never confer authority.
- Fixtures resolve through the scoped host store: grant check → source_ref shape → byte-length bound → Git blob SHA-1 recompute vs the pin → structural pre-split of `rows` → one object charged **per row span before parsing**. `HASH_MISMATCH`, `TARGET_MISMATCH`, `READ_DENIED`, `INPUT_TOO_DEEP` refuse with no partial output.
- Classification comes from the **exact structured** `objective.tag` against taxonomy v1 (`AWARENESS`/`CONSIDERATION`/`CONVERSION`); anything else → `UNKNOWN_TAG`, never forced. No semantics inferred from copy.
- Events: unique `event_id` (identical repeat = duplicate, counted once; conflicting repeat → `REFUSED`/`DUPLICATE_EVENT_CONFLICT`); `timestamp` must be a valid UTC instant inside the period (out-of-window excluded with counts); `kind` in `IMPRESSION/CLICK/CONVERSION/SPEND/REVENUE`; `amount_minor` required integer ≥ 0 for money kinds.
- Conversion dedup: one `conversion_id` counted once per campaign/period — identical payloads → `COUNTED_ONCE`; conflicting payloads or ambiguous binding → `CONFLICT_EXCLUDED`, counted zero, flagged.
- Attribution is the **exact registered binding** (`bindings` fixture: one row mapping `event_id` → its own `campaign_id`, agreeing with any stated `attribution_campaign_id`). Missing/ambiguous attribution makes the campaign's conversion/revenue metrics `UNAVAILABLE` (never silently zeroed); impressions/clicks/CTR/spend still compute.
- Metrics per campaign+period+currency: CTR = unique valid clicks / impressions; conversion rate = unique valid conversions / **clicks** (never impressions); ROAS = attributed revenue_minor / spend_minor. Zero denominator → typed `UNDEFINED`. All arithmetic is exact BigInt rational; display is 2-decimal % / 4-decimal ROAS, half-away-from-zero; comparisons use exact values (a claimed `16.67%` mismatches a true 1/6).
- Pooling sums denominators for host-declared disjoint populations — never averages rates; no cross-currency totals, no FX.
- Aggregate-count mode: rows are explicitly claimed primary counts; never mixed with event rows for the same population (`MIXED_EVIDENCE_MODE`); without a complete-population declaration the metrics are `UNVERIFIABLE`.
- Header claims compare at the same grain (campaign + period + currency) with both claimed and computed values preserved on mismatch; quarantined claims are never compared (evidence is never upgraded).
- Drafts render the 3 host-pinned templates from invented `product_label` + registry `benefit_id` + registry `cta_id`, always labeled `DRAFT — NOT PUBLISHED`. Unknown benefit/CTA/template → no copy. Length is Unicode codepoints of the **complete** render: over max → omitted whole with `LENGTH_LIMIT`, never truncated. A post-render inertness scan drops anything containing guarantees, contact info, or publish instructions.
- Seeded injection families (`FORGED_AUDITOR`, `FAKE_AUTHORITY`, `PII_CANARY`, `PUBLISH_DIRECTIVE`, `EXFIL_DIRECTIVE`) quarantine their record's text/support; clean independent fields still analyze with explicit quarantine accounting.
- Budgets per run: 256 KiB input, 64 consulted objects, 512 evidence spans, 256 output records, 256 KiB output. The 65th object / 513th span refuses before that candidate is touched. Exhaustion → small `complete:false` refusal, never partial success. Each battery case runs in a worker under a 5 s host watchdog.

## Charging model (hand-verifiable)

Objects, in order: task envelope (1); per fixture_ref — the store entry (1), then each `rows` span (1 each, charged before parsing). Spans: campaign rows 2, event rows 4, binding rows 2, conversion/revenue attribution + conversion-identity 2 each, duplicate groups 1, header-claim rows 2 + 1 per evidence span, brief rows 2, drafts 2 each, integrity checks 1.

## Limitations

- Synthetic fixture scaffolding only. No live analytics, no customer/tenant/financial data, no publishing/sending/spending/targeting, no model calls, no network.
- The authority table and fixture store are host-injected test doubles labeled as such; nothing here is production identity or signing.
- Injection recognition covers seeded families only; real safety comes from the absence of execution capabilities and structured allowlists.
- A passing finite battery does not certify general NL understanding, security, or domain correctness outside this contract.
