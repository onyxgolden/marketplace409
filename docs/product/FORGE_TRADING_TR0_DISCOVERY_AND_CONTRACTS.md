# FORGE Trading TR-0: Discovery and Contracts

**Status:** Planning documents only. No schema, migration, product code, UI, provider-connection code,
secret, paper order, live order, production access, or deployment was created to produce this
document. Nothing here was merged.
**Prepared:** 2026-09-10, against `origin/main` (tip at time of writing includes PR #157 and #158).
**Companion documents:** `docs/product/FORGE_TRADING_ARCHITECTURE_AND_PHASED_PLAN.md` (the revised
architecture this phase was scoped from), `docs/product/FORGE_TRADING_IMPLEMENTATION_HANDOFF_PROMPTS.md`
(TR-0's own prompt, followed here).

**Evidence discipline used throughout this document:**
- 🟢 **Verified repository fact** — exact path/symbol cited, read directly.
- 🔵 **Verified external fact** — direct official vendor/regulator link + access date.
- 🟡 **Architectural recommendation** — this document's own judgment, labeled as such.
- 🔒 **Unresolved, needs qualified counsel** — not decided here.

---

## 1. Domain classification: `risk`, `decision`, `knowledge`, `financial-intelligence`

The architecture plan's §2 flagged all four of these as "candidate for reuse — needs deeper TR-0
review," based on file/symbol names alone, not their actual contents. This section reads each fully.
**The result substantially revises that earlier speculation: three of the four are retire-for-trading,
not reuse candidates. Only `decision` holds up, and only as an architectural pattern, not literal code.**

### 1.1 `src/domains/risk/` — **Retire (for trading)**

🟢 Read in full: `risk.types.ts`, `risk-engine.service.ts`, `risk-scoring.service.ts`,
`risk-aggregation.service.ts`, `risk-watchlist.service.ts`, `risk-monitoring.service.ts`, and the
`risk-executive-*` report/narrative/scorecard chain (17 files total).

This is **not** a securities risk-and-suitability engine. It is Financial FORGE's own **accounting/
audit-finding risk scorer**. `RiskScoringService.scoreAuditFinding()` takes an `AuditFinding`
(`accountId`, `type`, `explanation`, `traceSummary`) and applies two hard-coded rules —
`NEGATIVE_BALANCE` → severity `high`/score 80, `LARGE_BALANCE` → severity `medium`/score 55, anything
else → `low`/score 20. `RiskAggregationService` rolls scored findings into an `OverallRiskSummary`.
`RiskWatchlistService`/`RiskMonitoringService` track these audit findings' persistence/trend across
historical snapshots for an executive narrative.

🟢 Confirmed wiring: `grep -rl "domains/risk"` across `src/` and `scripts/` returns exactly one
external caller, `src/infrastructure/composition/createFinancialApplicationSuite.js:92,354-355`,
which instantiates `RiskDashboardService` alongside `auditAgent` and `NetWorthService` inside
`FinancialDashboardIntelligenceApplication`. This confirms the domain's real purpose: bookkeeping-
integrity monitoring for Financial FORGE's own ledger, not portfolio/position risk for a trading
account.

**Why this matters for the architecture plan's §5.1 "Risk and Suitability Controls" bounded context**:
that context needs policy data and deterministic evaluation for max-order/position/leverage/
concentration/trading-hours limits — nothing in this domain's actual code does that. Building
Risk and Suitability Controls is genuinely new design; this domain contributes no reusable logic to
it, only a stylistic precedent (rule-based severity scoring exists elsewhere in the codebase, so the
general *shape* of "deterministic rule → severity/score/explanation" isn't unprecedented — that's the
only transferable idea here).

### 1.2 `src/domains/decision/` — **Adapt the pattern, not the code**

🟢 Read in full: `decision.ts`, `decision-workflow.service.ts`, `decision-outcome-evaluator.ts`,
`decision-collection.ts`, `InMemoryDecisionOutcomeRepository.js`, `SupabaseDecisionOutcomeRepository.js`
(7 files).

This is a genuine, generic, well-tested **recommendation → human-decision → outcome** state machine:
`Decision` (frozen value object: `id`, `context: unknown`, `recommendation: unknown`, `confidence`,
`priority`, `status: "open"|"accepted"|"rejected"|"completed"`, `selectedAction`, `outcome`) with
`DecisionWorkflowService.accept()`/`.reject()`/`.complete()` enforcing valid transitions (e.g. only an
`"open"` decision can be accepted or rejected), and `DecisionOutcomeEvaluator.evaluate()` which
**refuses to evaluate anything not already `"completed"`** — a real precedent for "you cannot skip to
an outcome without going through the state machine."

🟢 Confirmed wiring: `src/application/decision/DecisionApplication.js` wraps the workflow service in
an application-layer facade; `src/infrastructure/composition/createDecisionOutcomeRepository.js` and
`createFinancialApplicationSuite.js` wire a `SupabaseDecisionOutcomeRepository` for persistence. This
is live, used code — not dormant scaffold.

**Relevance to the trading plan**: this is architecturally close to what TR-2.5 needs for Brain-
generated `trading_order_proposal`s (propose → human accept/reject → outcome), and to the decision-
journal (§6 `trading_decision_journal_entries`) — but its `context`/`recommendation`/`outcome` fields
are typed `unknown`, deliberately generic. A trading proposal needs concrete typed fields (security,
quantity, rationale, evidence, expiration) that this domain doesn't provide and shouldn't be forced
into. 🟡 **Recommendation: TR-2.5 should follow this domain's *state-machine discipline* (frozen
value object, explicit valid-transition guards, evaluation refused until terminal state) as a design
precedent, but define its own typed `trading_order_proposal` entity — do not attempt to literally
extend or wrap the generic `Decision` class.**

### 1.3 `src/domains/knowledge/` — **Retire (for trading)**

🟢 Read in full: `knowledge.types.ts`, `category-map.ts`, `category-normalizer.ts` (3 files, 316
lines total).

This is a **rental/property-accounting transaction-category taxonomy**: `ForgeCategory` is an enum of
real-estate bookkeeping categories (`rental_income`, `cam_income`, `tenant_deposit`,
`property_repairs`, `mortgage_interest`, `property_tax`, `vehicle_maintenance`, etc.), and
`KnowledgeRecord` maps a raw imported transaction description to one of these categories plus
tax-deductibility/NOI/capitalization flags.

🟢 Confirmed wiring: `src/domains/rentec-financial-history-import/rentecFinancialHistoryImportPreview.js`,
`src/application/financial/expenseCategoryGroups.js`, `src/application/rental/buildRentalFinancialPerformance.js`
— all rental-bookkeeping-specific.

There is **no overlap** with the architecture plan's Research/Evidence bounded context (cited source
material — filings, transcripts, news). The naming ("knowledge") created a false expectation; the
actual content is entirely about categorizing real-estate expense transactions for tax/NOI purposes.
**Retire as a candidate for trading reuse — wrong domain entirely.**

### 1.4 `src/domains/financial-intelligence/` — **Retire (for trading)**

🟢 Read in full: `FinancialForecastService.js`, `FinancialScenarioModelingService.js`,
`FinancialTrendAnalysisService.js`, `FinancialRecommendationService.js`, `FinancialPlanningService.js`
(all 5 files — the largest is 32 lines).

These are trivial, rule-based **property-business KPI toy services**, not statistical or ML models.
`FinancialForecastService.forecast()` literally returns the current period's revenue/expenses as
"next period baseline" (`method: "current-period-baseline"`) — no actual forecasting. `Financial
ScenarioModelingService.model()` computes exactly two hard-coded scenarios: revenue down 10%, expenses
up 10%. `FinancialTrendAnalysisService.analyze()` classifies profitability/liquidity/leverage via
single-threshold comparisons (e.g. `liabilities/assets > 0.5` → `"elevated"`).

The architecture plan's §3 speculated `FinancialScenarioModelingService.js` was "a real candidate for
reuse in Brain's scenario-analysis capability (§9)." **Having read the actual implementation, this
does not hold up.** A genuine portfolio scenario-analysis/stress-test capability (the architecture
plan's §9 requirement) needs to model market moves, correlation, drawdown paths — nothing here does
that; this is a fixed two-scenario P&L toy for a rental business's revenue/expense line, not a
reusable scenario engine. **Retire as a candidate for trading reuse.**

### 1.5 Summary table

| Domain | Architecture plan's original speculation | This TR-0 finding | Verdict |
|---|---|---|---|
| `risk` | "candidate for reuse — needs deeper review" | Accounting-audit-finding scorer, wired only to Financial FORGE's bookkeeping dashboard; zero securities-suitability logic | **Retire** |
| `decision` | "candidate for reuse — needs deeper review" | Real, generic, well-tested recommendation→accept/reject→outcome state machine, genuinely live-wired | **Adapt the pattern, not the code** |
| `knowledge` | "candidate for reuse — needs deeper review" | Rental/property expense-category taxonomy, no relation to Research/Evidence | **Retire** |
| `financial-intelligence` | "candidate for reuse — needs deeper review" | Trivial rule-based property-business KPI toys, not a scenario/stress-test engine | **Retire** |

---

## 2. Domain glossary

🟡 Architectural recommendation — terms as used consistently throughout this program's documents.

| Term | Definition |
|---|---|
| **Instrument** | A canonical, stable-identity security (equity/ETF in TR-2 scope) — the `trading_instruments` row. A ticker symbol is a time-bound label on an instrument, not the identity itself. |
| **Trading account** | A `trading_accounts` row with an immutable `mode` (`paper`\|`live`) set at creation. |
| **Order** | A `draft`→...→terminal-state lifecycle instance (§5.2 of the architecture plan), replayable from its immutable `trading_order_events` stream. |
| **Fill** | A partial or complete execution of an order at a price, recorded as an immutable event; `trading_fills` is a rebuildable projection over fill events, never independent truth. |
| **Position** | A rebuildable projection of an account's net holdings in an instrument, derived from filled order events plus corporate actions — never independently mutated. |
| **Proposal** (`trading_order_proposal`) | Brain-generated suggestion (security, quantity, rationale, evidence, expiration) that only becomes a canonical order once a human explicitly accepts it. Brain can never write a canonical order directly. |
| **Paper simulation** | The versioned, deterministic fill-policy engine (§7) that writes into the *same* order-event contract a live broker adapter would use — same lifecycle, different execution adapter. |
| **Aggregate exposure** | Sum of current live market exposure + reserved open-order exposure + unsettled purchases + estimated fees for a live account — the quantity the $100 guardrail caps (§4 below). |
| **Fail closed** | When a required input (a price, a balance, a replay result) can't be trusted or computed, the system must refuse to proceed or display a number, rather than defaulting to zero or "no risk." This program's established precedent: `BorrowerSummaryUnavailableError` in the private-financing domain, which replaced a fallback that silently displayed `$0.00` instead of failing closed. |

---

## 3. Paper/live invariant ADRs

### ADR-001: Paper and live accounts are structurally distinct rows, not a flag

**Context**: the architecture plan (§12) requires that a paper order can never become a live order "by
changing an environment flag."

**Decision**: `trading_accounts.mode` (`paper`\|`live`) is set once at row creation and is immutable —
no RPC that mutates money-adjacent trading state may accept a request to change it. A "live" account
is a structurally different row from a "paper" account, distinguished by an immutable database column,
not a runtime toggle.

**Consequences**: every RPC touching orders, fills, or cash must check `mode` explicitly server-side
(never trust a client-supplied mode). Migrating a user from paper to live (TR-6) means creating a
**new** live account, never flipping an existing paper account's mode.

**Alternatives considered**: a mutable `mode` column gated by a permission check — rejected, because a
permission-check bug is a single point of failure for a safety property this program has committed to
enforcing structurally, not procedurally (matching this session's established precedent: the Repair
Controller's `AUTHORITY_CEILING_THIS_VERSION` hard-caps behavior regardless of input, rather than
relying on a policy check that could be misconfigured).

### ADR-002: Brain proposes, a human creates

**Context**: per the architecture plan's §9 (revised after ChatGPT's architecture review), Brain must
never be able to write a canonical order directly — a compromised research document or hallucination
must be structurally incapable of creating order-ledger state.

**Decision**: Brain's own service-role/RPC access can create a `trading_order_proposal` only. A
separate, explicit human "accept" action (requiring an authenticated human actor identity, not a
service-role or Brain-originated identity) is the only path that creates a canonical `draft` order.

**Consequences**: the RPC that creates a canonical `draft` order must verify its caller's actor
identity is a human user, not the Brain service role — this needs to be enforced at the RPC boundary
(🟡 recommendation: same `SECURITY DEFINER` + explicit `auth.role()`/actor-identity check pattern
already used throughout the private-financing RPCs, e.g. `if auth.role() <> 'service_role' then raise
exception` — inverted here to require a human, not a service role).

**Alternatives considered**: letting Brain create a `draft` order directly but requiring
`validated`→`approved` human confirmation before submission — rejected per ChatGPT's review, because
this still lets a compromised proposal pathway write into the order-event ledger at all, even in a
non-submittable state; better to keep Brain's writes entirely outside that ledger until a human acts.

### ADR-003: Fill truth has exactly one authoritative source

**Context**: per ChatGPT's architecture review (correction #3), fill data must not be able to exist in
two disagreeing places.

**Decision**: immutable fill-type events inside `trading_order_events` are the sole authoritative
source of fill truth. `trading_fills`, `trading_positions`, cash, lots, and P&L are all rebuildable
projections, each retaining a `source_event_id` pointing back to the event it was derived from.

**Consequences**: a property test must prove every projection can be deleted and rebuilt identically
from the event stream alone (already specified in the architecture plan's §15).

**Alternatives considered**: writing fills to both the event stream and a separate `trading_fills`
table independently at write time — rejected, this is exactly the two-writer pattern that could
silently disagree; instead `trading_fills` should be populated *from* the event, in the same
transaction, never independently.

---

## 4. Threat model and regulatory-decision register

### 4.1 Threat model (full table, expanding the architecture plan's §12 sketch)

| Threat | Attack/failure surface | Mitigation | Residual risk |
|---|---|---|---|
| Unauthorized order submission | A non-owner actor submits an order against another user's account | Server-side ownership resolution (never trust client-supplied account/owner id, same pattern as every RPC audited this session); mandatory `previewed`→`approved` human-confirmation gate; idempotency keys | Low, contingent on RLS/RPC discipline being followed as rigorously as private-financing's was |
| Brain hallucinating a security's fundamentals or fabricating evidence | A research query returns an ungrounded claim presented as fact | §9's citation-or-abstain contract: every claim must carry a source citation; Brain can only *propose*, never submit, so a bad proposal is reviewable before any consequence | Medium until TR-1B's abstention behavior is actually tested against adversarial prompts, not just happy-path Q&A |
| Prompt injection via a retrieved research document | A malicious filing/news excerpt contains instructions Brain follows | Retrieved content is stored as provenance-tagged data and must never be executed as instructions (same discipline already required of this session's own tool use); even a successfully-injected document can at worst produce a bad *proposal*, never a live action, per ADR-002 | Low-medium; needs an explicit adversarial-input test suite in TR-1B/TR-2.5, not just a design statement |
| Mis-priced paper fill giving a false sense of live viability | A paper fill policy that's unrealistically generous (e.g. always fills at last price) | §7's versioned, conservative fill-policy requirement (bid/ask-aware, explicit slippage fallback); thinkorswim's own "results don't guarantee live success" disclosure pattern (§4 of the architecture plan) adopted explicitly | Medium — this is a design commitment, not yet implemented; TR-2's actual fill-policy tests are what retire this risk |
| Credential/token leakage via a future live-broker connection | An OAuth token or API key is logged, exposed, or accessible outside its intended boundary | Reuse `src/domains/connection/`'s existing credential-vault pattern (`SupabaseCredentialVaultRepository.js`, confirmed present) — never build a second, parallel credential store for brokerage tokens | Low, contingent on TR-5 actually reusing this rather than inventing a new store under schedule pressure |
| A risk-policy change silently reinterpreting a past order's evaluation | Policy row is edited in place, changing what "was allowed" retroactively | Risk policy is versioned data (§5.1); every order's `validated` evaluation is checked against the policy version in effect at that time, not the current one | Low, contingent on the versioning actually being enforced at read time, not just write time |
| The $100 aggregate guardrail computed against a stale or unavailable price | A market-data outage or a delisted/illiquid instrument makes exposure uncomputable | Fail closed: if exposure can't be calculated with confidence, the system must refuse to allow a new live-exposure-increasing action, never assume $0 | **This is the single highest-consequence failure mode in the entire live-pilot design** — see §5 below for its full, explicit treatment |
| Duplicate order submission under client retry or network flakiness | A user's client retries a submission after a timeout, unsure if the first attempt succeeded | Idempotency keys on every order-creation/submission call, same discipline as this session's private-financing and rental payment-chain proofs | Low, this pattern is proven repeatedly elsewhere in this codebase |
| A completed live trade needs correction after execution | Something goes wrong post-fill in TR-6 | **A filled trade cannot be rolled back like a migration.** Response is limited to: contain remaining exposure, cancel if still open, or execute a separately-approved corrective transaction (e.g. a deliberate offsetting trade) — this must be written into the TR-6 incident runbook explicitly, never described as a "rollback" | 🔒 Needs a real incident runbook and rehearsal before TR-6, not just this design statement |
| Vendor discontinuation or licensing change mid-program | A market-data vendor shuts down (🔵 e.g. IEX Cloud, discontinued August 31 2024 per its own site, `iexcloud.org`, accessed 2026-09-10) or changes redistribution terms | Provider-neutral domain model (architecture plan principle #7) — instrument/quote data is normalized into FORGE's own schema, never bound to one vendor's response shape | Medium — this is a real, precedented risk (see §5's vendor evaluation), not hypothetical |

### 4.2 Regulatory-decision register

| Item | Status | Notes |
|---|---|---|
| Is FORGE Trading providing "investment advice" via Brain's research/education features? | 🔒 Unresolved, needs qualified securities counsel | The architecture plan's §9 models Brain as evidence-grounded and explicitly non-advisory (matching Public Alpha's public "not financial advice" framing, §4), but whether that framing is legally sufficient is a counsel question, not an engineering one. |
| Does *read-only* broker account/position import (TR-5) trigger different regulatory treatment than live order submission (TR-6)? | 🔒 Unresolved, needs qualified counsel | Flagged explicitly in the architecture plan's Open Decision #2; this TR-0 pass found no repository or public-documentation evidence that resolves it — it is a genuine legal question. |
| Market-data redistribution/display licensing | 🔵 Partially resolved by this TR-0's vendor research (§5) — the *pattern* is clear (personal/individual tiers exclude customer-facing display; a business-tier agreement is required), but the exact terms for whichever vendor is finally selected still need direct, written confirmation from that vendor before TR-1A writes any ingestion code. | Not a counsel question — a vendor-contract question. |
| Suitability/disclosure requirements for the $100 controlled live pilot (TR-6) | 🔒 Unresolved, needs qualified counsel | Even at $100 aggregate exposure, real-money order submission likely has disclosure/suitability obligations that scale with the *type* of account/relationship (self-directed brokerage via an adapter vs. FORGE itself acting as an intermediary) — this distinction needs counsel input, not an assumption either way. |
| Record retention requirements for order/fill/communication history | 🔒 Unresolved, needs qualified counsel | Standard for broker-adjacent systems, but the exact retention period and what counts as a "communication" (does an AI-generated Brain proposal count?) needs a real answer before TR-6, not TR-0. |
| Tax reporting obligations (1099-B equivalents, cost-basis reporting) once TR-6 exists | 🔒 Unresolved, needs qualified counsel | The architecture plan's already-resolved engineering decision (display/reconcile broker-reported tax lots rather than FORGE claiming to be a tax authority, §16) reduces but does not eliminate this — whether FORGE has any reporting obligation of its own is a counsel question. |

---

## 5. Market-data/security-master provider capability matrix (resolves Open Decision #1)

🟡 **This section's job is to give TR-1A a real, evidence-backed recommendation** — not just list
options, per Jason's explicit instruction. All pricing/licensing facts below are 🔵 verified directly
against each vendor's own site, accessed 2026-09-10, unless marked otherwise.

### 5.1 Candidates evaluated

| Vendor | Delayed/EOD offering | Licensing for customer-facing display | Sandbox/free tier | Corporate-action coverage | Cost at TR-1A's scale | Lock-in risk |
|---|---|---|---|---|---|---|
| **Massive (formerly Polygon.io)** — [massive.com/stocks](https://massive.com/stocks), accessed 2026-09-10 | Starter ($29/mo): 15-min delayed intraday, unlimited calls. Basic (free): EOD data, 5 calls/min, all tickers + reference data. | 🔵 Explicit: "Individual plans (Basic → Advanced) are licensed for personal and non-professional use... For brokerage, redistribution, customer-facing display, or 200+ users, you'll need a Business plan." Business plans start at **$2,499/mo** and include "Commercial & display rights." | Free tier, no credit card required, instant access | Not confirmed on this page — needs direct follow-up before selection | $29–79/mo for *development*; **$2,499/mo minimum for actual production display to FORGE's users** | 🔵 Rebranded from Polygon.io to Massive in July 2026 (URL redirect confirmed) — API/keys reportedly unchanged, but a rebrand mid-relationship is itself a documented instance of vendor volatility in this exact space |
| **Twelve Data** — [twelvedata.com/pricing](https://twelvedata.com/pricing), accessed 2026-09-10 | Grow ($29/mo): EOD global equities/ETFs, 20+ markets. Basic (free): "trial symbols only." | 🔵 Explicit: plans are for "personal, internal, and non-commercial purposes"; free tier is labeled "Internal non-display usage." Commercial display requires contacting their business/sales team — **exact commercial price not published**. | Free tier exists, but explicitly excludes display use | Not confirmed on this page | Cheapest published tier ($29/mo) still excludes display use; real cost unknown until a sales conversation happens | Same "contact sales for the license you actually need" pattern as Massive — genuine cost is unknown until negotiated |
| **Alpha Vantage** — [alphavantage.co/premium](https://www.alphavantage.co/premium/), accessed 2026-09-10 | $49.99–249.99/mo tiers by request-rate; 15-min delayed data available via a separate "Alpha X Terminal" entitlement process. Free tier: 25 requests/day. | 🔵 **Not stated on the public pricing page at all** — no redistribution/display licensing language found. This is a genuine information gap, not a favorable finding; treat as unknown until directly confirmed with the vendor, not as "no restriction." | 25 req/day free, no card required | Not confirmed | $49.99+/mo for development; production licensing cost genuinely unknown | Unknown licensing terms is itself a risk — don't select without written confirmation |
| **IEX Cloud** | N/A | N/A | N/A | N/A | N/A | 🔵 **Discontinued.** IEX Group retired all IEX Cloud API products by August 31, 2024 (`iexcloud.org`, the service's own former domain, now hosts the shutdown notice; accessed 2026-09-10). No successor product was offered. Ruled out entirely — included here only as a documented cautionary precedent for vendor-discontinuation risk (§4.1's threat table). |
| **SEC EDGAR** (full-text search + company-facts APIs) — [sec.gov/os/webmaster-faq](https://www.sec.gov/os/webmaster-faq), accessed 2026-09-10 | N/A — this is a fundamentals/filings source, not a quote vendor; carried forward from the architecture plan's §14 for the Research/Evidence bounded context, not TR-1A's quote pipeline | 🔵 Free, official, US government source. Rate limit: 10 requests/second, "carefully monitored to preserve equitable access." Requires a declared `User-Agent` header identifying the requester; undeclared automated access is rejected. | N/A, always free | N/A | Free | None — this is the primary-source citation target §9 requires; no commercial alternative is more authoritative for SEC filings |

### 5.2 Finding: the licensing pattern, not just the individual vendor terms

🟡 **The single most important finding of this section**: across every quote vendor checked, the
pattern is consistent — **an individual/developer-tier plan, however cheap, explicitly excludes
customer-facing display**, and the real commercial license (the one FORGE Trading actually needs,
since its entire purpose is showing quotes to end users) is either a large fixed monthly cost
(Massive: $2,499/mo minimum) or an unpublished, negotiated price (Twelve Data, and likely Alpha
Vantage once confirmed). **The architecture plan's own framing — that this "genuinely gates the
phase, it isn't a detail to defer" — is confirmed exactly right by this research, not overcautious.**

### 5.3 Recommendation

🟡 **Recommend Massive (formerly Polygon.io) as the TR-1A candidate to pursue a real commercial
conversation with first**, for three reasons: (1) its licensing terms are the most explicit and
publicly documented of the three checked — a real number ($2,499/mo) to plan against, not an unknown
to discover during a sales call; (2) its free/individual tier is sufficient for TR-1A's actual
*development and testing* work (ingestion correctness, provenance, timestamp discipline) without
needing the commercial license until the phase is ready to ship a display surface, which doesn't
happen until TR-1B; (3) corporate-action coverage needs direct written confirmation from Massive's
sales team regardless of which vendor is chosen — that conversation is the natural moment to also
finalize the display-license terms.

**This recommendation is explicitly not a final vendor selection** — it's a recommended next
conversation, not a signed contract. 🔒 The actual $2,499/mo (or negotiated equivalent) commercial
license is a real budget decision Jason should make explicitly before TR-1B ships anything
display-facing, separate from TR-0/TR-1A's development-tier usage.

---

## 6. Acceptance criteria and testing strategy: TR-1A and TR-1B

### 6.1 TR-1A — Security master and market data

**Acceptance criteria:**
- A small fixed symbol set (10-20 large-cap symbols, per the handoff prompt) is ingestible with a
  stable, delisting-safe internal instrument ID distinct from the vendor's own ticker/symbol scheme.
- Every ingested quote carries both `effective_at` (when the price was true) and `received_at` (when
  FORGE received it), asserted as distinct in at least one test where they differ.
- A corrected/restated quote from the vendor produces a **new, timestamped row** — never an in-place
  edit of a prior quote.
- Adjusted vs. unadjusted price is explicitly labeled on every quote row, not inferred.
- RLS is force-enabled on every new table, using the workspace/acting-user pattern — a direct
  `owner_id = auth.uid()` policy (the `investment_accounts` anti-pattern identified in §2 of the
  architecture plan) is a test failure, not a style preference.
- Whichever vendor is actually wired matches what this TR-0 (or a follow-up vendor-selection step)
  resolved, and its licensing terms are confirmed in writing to permit the exact ingestion/storage
  pattern implemented — not assumed from a public pricing page alone.

**Testing strategy:** unit tests for symbol-identity stability across a simulated delisting/reuse
scenario; a provenance/timestamp test asserting `effective_at` ≠ `received_at` is preserved distinctly
through the ingestion pipeline; a correction-handling test proving a restated quote never mutates the
original row; an adjusted/unadjusted labeling test; RLS integration tests (real Postgres, not mocked)
for every new table, covering both authorized and cross-workspace-denied access.

### 6.2 TR-1B — Watchlist, research, and Brain Q&A

**Acceptance criteria:**
- A user can save/remove symbols from TR-1A's instrument set into a workspace-scoped watchlist.
- A basic quote display and a simple price/volume chart render TR-1A's data with its timestamps
  visible (no technical-indicator charting — out of scope per the handoff prompt).
- The research-evidence store (`trading_research_evidence`) stores references/hashes/permitted
  excerpts, never assumes wholesale retention rights over a filing or article (per the architecture
  plan's revised §6 research-licensing discipline).
- Brain Q&A about a security either returns a cited answer (every claim traceable to a stored
  evidence reference with timestamp/source) or explicitly abstains — there must be a real,
  automated test for the abstention path, not just the happy path, matching the handoff prompt's own
  requirement.
- Brain Q&A is a genuinely new end-user-facing route; it must not touch or extend
  `src/app/api/forge/engineering-brain/*`, which stays developer-only (confirmed 🟢 via
  `src/app/api/forge/engineering-brain/query/route.js`'s `ProgrammerAuthorizationApplication` +
  `is_forge_programmer()` gating, read in this program's earlier architecture-planning pass).
- Curriculum modules 1-4 (investing vs. trading vs. speculation; diversification/allocation/
  risk-reward/liquidity; order types/spread/slippage; position sizing/concentration/DCA) each have a
  working concept check, graded by a deterministic, non-Brain-authored answer key (per §16's already-
  resolved concept-check-leakage decision) — Brain may explain but never grades.

**Testing strategy:** citation-or-abstain contract tests (both paths, not just happy-path); watchlist
CRUD + RLS tests; research-evidence licensing-discipline tests (asserting only references/hashes/
permitted excerpts are stored, never a full retained document body without an explicit permitted-
excerpt flag); concept-check grading-determinism tests (same input, same grade, every run, and Brain
cannot influence the grade); an explicit test that the new Brain Q&A route is authorization-scoped
independently of the developer-only Engineering Brain route (i.e. a developer's `is_forge_programmer()`
grant does not implicitly grant access to the new route, and vice versa).

---

## 7. Ledger authority ambiguity — recorded, not resolved (TR-0.5's job)

Per the handoff prompt's explicit instruction, this section only characterizes the ambiguity; **it
does not attempt to resolve which structure is Financial FORGE's authoritative general ledger.**
TR-0.5 is the dedicated phase for that, required only before TR-4.

🟢 **Both candidate structures are genuinely wired into live application code**, which is itself the
core of the ambiguity — this isn't a case of one live system and one obviously-dormant scaffold:

- `src/domains/ledger/` (`JournalEntry.js`, `Posting.js`, `GeneralLedger.js`, `ChartOfAccounts.js`,
  `TrialBalanceCalculator.js` and siblings) is referenced by
  `src/infrastructure/composition/createFinancialSnapshotApplication.js`,
  `createFinancialSnapshotRepository.js`, `createFinancialApplicationSuite.js`,
  `src/domains/audit/AutonomousAuditAgent.js`, and `src/application/financial/FinancialSnapshotViewApplication.js`
  — a real, non-trivial set of live callers.
- The event-sourced `financial_events` table (the pattern `private_financing_events` and the rental
  payment chain both post to, independently verified correct by this session multiple times) is
  referenced directly in at least 7 files across `src/`.

**What TR-0.5 needs to determine, that this pass deliberately did not**: whether one of these is
authoritative and the other a read-projection/reporting view over it, whether they serve genuinely
different purposes (e.g. the classical `ledger/` domain for formal double-entry statements, and
`financial_events` as the operational event log that feeds it), or whether they've drifted into two
independently-written sources of truth that could disagree. **This TR-0 pass found evidence that both
are real and wired — not evidence of which one, if either, is authoritative for the purpose §8's TR-4
integration contract needs (where should summarized trading journal entries post to?).**

🟡 The trading domain's own design does not depend on this answer for TR-0 through TR-3 — its event-
sourced order/fill ledger (§6 of the architecture plan) is independently correct regardless of which
Financial FORGE structure it eventually posts summarized entries into. Only TR-4 is blocked pending
TR-0.5.

---

## 8. The $100 aggregate live-pilot guardrail (recorded verbatim, expanded on)

> Jason's controlled live pilot permits no more than $100 of aggregate real-money exposure, including
> positions, reserved open orders, unsettled purchases, and estimated fees. No leverage, margin,
> options, short selling, or automated execution. AI may propose an order; only an authenticated
> human may create, approve, and submit it. Any future change requires separate explicit
> authorization.

This guardrail is **not recoverable from any existing repository artifact** (confirmed again in this
TR-0 pass — no new evidence found that changes the earlier architecture-planning finding). It exists
solely because Jason stated it directly, relayed through this program's planning conversation. This
document is its second durable, repo-tracked home (the first being the merged architecture/handoff-
prompts documents themselves, PR #157) — 🟡 recommend this program's actual TR-6 implementation store
it as literal policy data (a versioned row, per ADR-discipline above), not just prose in a planning
document, so a future engineer enforcing it programmatically has a canonical source to read from
rather than re-transcribing this paragraph.

**Precision points that must not be lost in any future retelling** (each independently verified
present, verbatim, in the merged architecture and handoff-prompts documents as of PR #157):
- **Aggregate**, not per-order: sums current live exposure + reserved open-order exposure +
  unsettled purchases + estimated fees.
- **Fails closed** when a price is stale or exposure can't be calculated — never assumes $0 exposure
  under uncertainty.
- Changing the cap requires a **separately authorized policy version**, not an ordinary settings edit.
- AI may only **propose**; only an authenticated human may create, approve, and submit an order
  (ADR-002 above is the structural mechanism for this).

---

## 9. What this TR-0 pass did not do (explicitly out of scope, confirmed)

No schema was created. No migration was written or applied. No product code was written (this
document and its companion planning files are the only output). No UI was built. No provider
connection code — not even a stub — was written for any vendor discussed in §5. No secret or
credential was created, read, or touched. No paper or live order was placed. No production database
was mutated (all repository evidence in this document came from reading source files in a local
worktree; no `supabase db query --linked` or equivalent production access was needed or used for this
phase, since it is a pure documentation/discovery task). Nothing was deployed. Nothing was merged —
this document is delivered as an open, unmerged PR per the handoff prompt's own requirement.
