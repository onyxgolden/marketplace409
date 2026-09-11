# FORGE Trading: Claude Implementation Handoff Prompts

**Revised** 2026-09-10 incorporating ChatGPT's architecture review: TR-1 split into TR-1A/TR-1B, a
new TR-2.5 (Brain order proposals) added, TR-0/TR-0.5's relationship to TR-4 (not TR-2) corrected,
TR-6's live-testing language and rollback framing corrected, UX acceptance criteria added per phase.
**Revised again** 2026-09-11 incorporating Jason's decision to defer paid market-data spend until
FORGE is profitable, **then revised a third time the same day per ChatGPT's review**: the original
single "TR-1F" prompt combined nearly the entire paper-trading application into one oversized,
unreviewable slice. It is now three separate, thin prompts — **TR-1F-A (Synthetic market
foundation)**, **TR-1F-B (Training and research foundation)**, and **TR-2F (Deterministic
paper-trading engine)** — each its own future branch/PR, plus a renamed, re-gated **TR-1A — Licensed
Market-Data Foundation (deferred until profitable)** prompt that is explicitly not to be started
without separate future budget authorization. See the companion architecture doc's §1/§13 for the
full reasoning.

Companion to `docs/product/FORGE_TRADING_ARCHITECTURE_AND_PHASED_PLAN.md` (deliverable #17 of that
plan). Each prompt below is self-contained enough to hand to a fresh Claude Code session for that
phase only. **None of these are authorized to run yet** — each still needs Jason's explicit
go-ahead, per the architecture plan's own recommended order (§13 of the companion doc). Every
prompt below carries the same non-negotiable footer; it is not repeated per-prompt for brevity, but
applies to all of them:

> Do not merge, deploy, apply a migration remotely, touch production, send any message/invitation,
> place any real or paper order beyond what the phase's own tests require, add or change secrets,
> or begin a later phase's scope. Work from a fresh isolated worktree off current `origin/main`,
> never the stale primary checkout. Commit, push a feature branch, open one reviewable PR per
> bounded slice, and stop — do not merge it. Report exact evidence (files, commits, test results)
> for every claim.

---

## TR-0 — Discovery and contracts

**Scope**: Produce the artifacts the architecture plan deferred: full read of `src/domains/risk/`,
`src/domains/decision/`, `src/domains/knowledge/`, and `src/domains/financial-intelligence/` with an
honest reuse/adapt/retire classification for each (the architecture plan flagged these as
unverified — this phase resolves that); a domain glossary; paper/live invariant ADRs; a threat model
and regulatory-decision register (the shape sketched in §12 of the architecture plan, filled in
properly); a market-data/security-master provider capability matrix answering Open Decision #1;
acceptance criteria and test strategy for TR-1F-A.

**Required, non-negotiable**: record Jason's live-pilot guardrail verbatim in whatever this phase
produces as the authoritative domain glossary/paper-live-invariant ADR set:

> Jason's controlled live pilot permits no more than $100 of aggregate real-money exposure, including
> positions, reserved open orders, unsettled purchases, and estimated fees. No leverage, margin,
> options, short selling, or automated execution. AI may propose an order; only an authenticated
> human may create, approve, and submit it. Any future change requires separate explicit
> authorization.

This guardrail is not recoverable from any existing repository artifact as of this plan's authoring
(§2 of the architecture plan) — TR-0 is this program's first opportunity to give it a durable,
repo-tracked home instead of leaving it dependent on this planning document or session memory. Do
not weaken, round, or generalize any part of it — including its **aggregate** nature (it sums
current live exposure + reserved open-order exposure + unsettled purchases + estimated fees, not a
per-order limit), its fail-closed behavior on stale/uncalculable prices, or the requirement that
changing it needs a separately authorized policy version — without a separate, explicit instruction
from Jason.

**Exclusions**: No schema, no code, no UI. This phase produces documents only, same as this planning
package.

**Evidence required**: exact file paths and symbols for every domain classified; direct links with
access dates for any vendor evaluated in the capability matrix.

**Stop condition**: TR-0 only needs to **record** the `src/domains/ledger/` vs.
event-sourced-ledger authority ambiguity (Open Decision #3) — it does not need to resolve it, and it
does not block TR-1F-A, TR-1F-B, TR-2F, TR-1A, TR-2.5, or TR-3. TR-0.5 is the phase that actually
resolves it, required only before TR-4. Stop and report only if you cannot even characterize the
ambiguity from repository evidence (i.e. you can't tell what's genuinely unclear) — don't guess at a
resolution here.

---

## TR-0.5 — Ledger-authority spike

**Scope**: Determine, with actual evidence (which code paths write to `src/domains/ledger/`'s
`JournalEntry`/`Posting`/`GeneralLedger` entities today, if any; which routes/services are wired to
them; whether they're live, dormant, or superseded by the event-sourced `financial_events`/
`private_financing_events` pattern), which structure is Financial FORGE's actual authoritative
general ledger today. This single question locks §8 of the architecture plan's TR-4 integration
contract. **It does not block TR-1F-A, TR-1F-B, TR-2F, TR-1A, TR-2.5, or TR-3** — those phases have no
dependency on this answer, since the trading domain's own event-sourced design stays independently
correct regardless of which ledger structure this resolves to. Can run any time before TR-4 starts.

**Exclusions**: No design changes to either structure. No code written beyond a throwaway
investigation script if needed (not committed).

**Evidence required**: a clear, cited answer — "X is authoritative because Y is the only thing that
writes to it and Z reads from it in production" or equivalent — not a guess.

**Stop condition**: if the evidence is genuinely ambiguous (e.g. both are partially wired), stop and
present the ambiguity to Jason rather than picking one to move forward with.

---

## TR-1F-A — Synthetic market foundation

**Scope**: The synthetic data foundation only — no order engine, no curriculum, no Brain, no
application UI (architecture plan §1/§13, three-way-split revision 2026-09-11).

- **Fictional security master**: `trading_instruments` (§6) rows with `data_origin='synthetic'`,
  drawn from a reserved fictional-exchange/symbol/name namespace that cannot be mistaken for a real
  security even without checking the flag — invent a clearly fictional exchange code and naming
  convention as part of this phase's own design work, don't borrow anything resembling a real ticker.
- **Versioned synthetic market scenarios** (`trading_synthetic_scenarios`, §6): deterministic,
  documented generation rules (state the rule, don't hand-tune bars to "look right"), committed as
  fixture files, covering at minimum: rising/falling/flat/volatile markets; spreads and slippage;
  market/limit/stop/stop-limit order behavior; partial fills; dividends and splits; concentration and
  diversification; drawdown and recovery; behavioral mistakes (FOMO, revenge trading — these can be
  scenario *setups* a lesson later reacts to, not something the fixture itself judges).
- **Security-master contract, market-data adapter interface, provenance model, and capability
  negotiation** (§6) — implement the adapter interface generally (e.g. `getQuote`, `getBars`,
  `getCorporateActions`) with a synthetic-fixture implementation *and* design it so a future licensed
  adapter (TR-1A) implements the identical interface — this is the actual deliverable that makes
  TR-1A a data-source swap later, so treat the interface design itself as load-bearing, not an
  afterthought.
- **Historical-style replay using synthetic data with strict look-ahead prevention** (§7) — the
  replay engine must be physically incapable of reading a fixture bar beyond the currently-simulated
  timestamp, not merely trusted not to.
- **Market-data provenance discipline**: every bar carries both `effective_at` and `received_at`
  distinctly, plus adjusted-vs-unadjusted price labeling for synthetic corporate actions.

**Exclusions**: no database migration unless repository evidence at implementation time demonstrates
persistence is genuinely required for this bounded slice (justify it, don't default to one); no order
engine, portfolio, Brain, curriculum, or application UI, except a minimal developer validation surface
if actually needed to demonstrate the adapter works; no real/licensed market-data vendor code of any
kind, not even a stub beyond the adapter *interface* itself.

**Tests**: security-master invariants (symbol identity stability, and a positive assertion that every
synthetic instrument's `data_origin='synthetic'` and its symbol/name/exchange cannot collide with a
real-security naming convention); synthetic-scenario provenance/timestamp correctness (`effective_at`
vs `received_at` distinctly asserted even though both are deterministically generated); look-ahead
prevention with a golden fixture that would fail under a naive "peek at future price" implementation;
determinism (identical seed + configuration produce identical scenario output, every run); RLS tests
for any new table.

**Evidence required**: the documented generation rule for each synthetic scenario (reproducibility
proof — a reviewer must be able to see *why* a scenario's bars look the way they do, not just that
they exist); confirmation the market-data adapter interface has no synthetic-specific leakage that a
downstream consumer would need to know about (i.e. the interface itself, read in isolation, gives no
hint whether the implementation behind it is synthetic or licensed).

**UX acceptance**: none beyond a minimal developer validation surface if one exists — TR-1F-A produces
no end-user-facing UI.

**Stop condition**: if any synthetic instrument's naming could plausibly be mistaken for a real
security (even briefly, even by an inattentive user), stop and fix the naming convention before
proceeding — this is not a cosmetic detail, it's the load-bearing safety property of the entire free
track. Also stop if the market-data adapter interface can't be cleanly designed so a downstream
consumer needs zero synthetic-specific knowledge — that would mean the provider-neutrality goal (§14)
has already failed before TR-1A even exists.

---

## TR-1F-B — Training and research foundation

**Scope**: Read-only training and research, built on TR-1F-A's security master and adapter — no
canonical orders, fills, cash, positions, lots, P&L, or statements of any kind.

- **Watchlist and simple fictional-security view** (`trading_watchlist_items`, §6) over TR-1F-A's
  security master.
- **Real-company research via SEC EDGAR and official company-facts APIs** — citations, timestamps,
  fair-access/rate-limit compliance, and an explicit, structural statement (not just a disclaimer
  buried in copy) that this data does not supply a tradable price for that company inside FORGE.
- **Research-evidence store** (`trading_research_evidence`, §6) with citations, timestamps, content
  hashes, and the licensing discipline already specified there (store references/hashes/permitted
  excerpts, never assume wholesale retention rights).
- **Read-only Brain research Q&A** with citation-or-abstain behavior (§9) — this is a genuinely new
  end-user-facing route; do not touch `src/app/api/forge/engineering-brain/*`, which stays
  developer-only.
- **Trading Coach curriculum modules 1-4**: plain-language explanations first, advanced
  terminology/calculations on demand (§11's content hierarchy); contextual help triggered by first
  use/unfamiliar term/explicit "Explain this"; the three-part parable structure (parable → concept
  mapping → stated limitation, §10) as a structural response format, not a style guideline; objective
  concept checks graded by a deterministic, non-Brain-authored answer key (§10/§16).
- **External links out** for a user who wants to see a real symbol's current price elsewhere — a
  plain link, nothing more. Do not scrape, proxy, cache, reproduce, or imply ownership of whatever is
  behind that link.
- **The "Training Scenario — No Real Money or Market Data" indicator** (§13's free-track UX
  requirements) — persistent, calm, unmistakable, not repeated per-component.

**Exclusions**: no canonical orders, fills, cash events, positions, lots, P&L, confirmations, or
statements of any kind — this phase is read-only and educational, not transactional; no Brain
order-proposal capability yet (TR-2.5); no curriculum modules 5-8 or behavioral-bias coaching yet
(TR-3).

**Tests**: citation-or-abstain behavior for Brain's SEC-research Q&A (the abstention path needs a
real test, not just the happy path); curriculum modules 1-4's concept-check grading logic (asserting
the deterministic answer key, not Brain-authored grading); a test proving the research-evidence
store never retains more than the source's permitted excerpt; RLS tests for every new table
(workspace/acting-user pattern, never direct-owner); a test asserting the training indicator is
present on every relevant surface.

**Evidence required**: confirmation Brain's Q&A route is genuinely separate from
`engineering-brain`'s developer-only route (different path, different authorization); confirmation
no test or code path treats a synthetic instrument's data as if it were tradable.

**UX acceptance**: watchlist, security detail/research view, and curriculum lesson screens match
§11's information hierarchy; guided and expert modes present differently but validate identically;
the training-scenario indicator is unmistakable but not repeated on every component; nothing anywhere
implies a synthetic result predicts real trading outcomes.

**Stop condition**: if implementing any part of this phase turns out to require a canonical order,
fill, or cash concept to work, stop — that scope belongs in TR-2F, not here; don't blur the boundary
to make a feature "feel complete."

---

## TR-2F — Deterministic paper-trading engine

**Scope**: The full paper-trading order/fill/cash/position ledger, built on TR-1F-A's synthetic
adapter only (architecture plan §5.2/§6/§7, contracts unchanged from the original design — only the
data source is synthetic).

- Paper `trading_accounts` (mode-immutable); equity/ETF order ticket (market/limit/stop/stop-limit,
  day/GTC); the canonical order state machine including the **replace relationship** (a cancel/replace
  creates a new order with `replaces_order_id`, never a same-order `replaced → open` transition,
  including the fill-wins-the-race outcome where `replacement_requested → filled` is a real, expected
  result); immutable `trading_order_events`, each carrying the (synthetic) adapter's raw payload
  (`raw_provider_payload`) alongside FORGE's normalized fields; deterministic risk-policy validation
  at `validated`; the `v1` versioned fill simulator with bid/ask-aware pricing where the scenario
  provides it, explicit spread/slippage fallback otherwise, workflow-specific stale-quote thresholds.
- **Fill events inside `trading_order_events` are the sole authoritative fill truth** — `trading_fills`,
  positions, lots, and P&L are all rebuildable projections carrying `source_event_id`, never a second
  copy of truth.
- The `trading_cash_events` stream as the sole source of cash truth, available cash computed as a
  projection over it, never an independently-mutated balance; confirmations and statements.
- Basic paper order ticket and review flow (the plain-language review sentence before the technical
  order summary, per §11).

**Exclusions**: no Brain-generated proposals or acceptance flow (TR-2.5, which depends on this
phase's order contract already existing); no licensed data (TR-1A); no live broker (TR-5); no
Financial FORGE posting (TR-4); no advanced strategy replay or curriculum modules 5-8 (TR-3).

**Tests**: full order-lifecycle state-machine coverage (every transition in §5.2's diagram, including
disallowed ones — e.g. a `filled` order cannot receive a new `canceled` event); the cancel/replace
race (original fills while `replacement_requested`); fill-policy determinism (same inputs, same fill,
every run); idempotency under retried order-submission; cross-account/cross-workspace denial;
paper-mode immutability (`mode` cannot change, verified by attempting it and asserting rejection);
**projection-rebuild property test**: delete `trading_fills`/positions/cash-balance projections and
rebuild them from `trading_order_events`/`trading_cash_events` alone, assert identical results (§15);
guided-vs-expert mode test asserting both routes through identical validation (§11); duplicate,
delayed, rejected, and stale-data cases each fail correctly and distinctly.

**Evidence required**: confirmation this phase's order/fill/cash code contains no reference to
`data_origin`, vendor names, or any other real-market-data-specific concept — this is the actual test
of "the order engine never needed to know the data was synthetic."

**UX acceptance**: order ticket reveals advanced settings only when selected while material
consequences (cost, cash impact, risk flags) stay always visible; the plain-language review sentence
appears before the technical order summary; guided and expert modes present differently but validate
identically; nothing anywhere implies a synthetic result predicts real trading outcomes.

**Stop condition**: if one fictional paper trade cannot be made to complete end to end with identical
projection-rebuild results, stop and report rather than shipping a partial/inconsistent ledger. Also
stop if any part of this phase's implementation turns out to require knowing whether the underlying
instrument is synthetic or licensed — that would mean TR-1F-A's adapter interface has a real leak.

---

## TR-1A — Licensed Market-Data Foundation (deferred until profitable; requires separate budget authorization)

**Do not begin this phase without: (1) confirmation FORGE is profitable enough to justify a recurring
market-data subscription, and (2) Jason's separate, explicit authorization of the specific budget —
this is a distinct gate from whatever authorized TR-0 through TR-1F, not something that unlocks
automatically once TR-1F ships.**

**Scope, unchanged from the original TR-1A design, only its position and gate changed**: security
master for a small fixed **real** symbol set (propose ~10-20 well-known large-cap symbols, not a
full exchange listing) — `trading_instruments` rows with `data_origin='licensed'`, using the exact
same table shape as TR-1F-A's synthetic rows; vendor mapping layer (FORGE instrument ID ↔ vendor's own
symbol/identifier scheme); delayed/EOD market-data ingestion with explicit `effective_at` **and**
`received_at` timestamps on every quote; adjusted-vs-unadjusted price labeling; corrections/
restatements from the vendor land as new, timestamped rows, never in-place edits. Implement this
phase's ingestion behind the **exact same market-data adapter interface TR-1F-A already designed** —
if that interface needs to change to accommodate a real vendor, treat that as a signal TR-1F-A's
"provider-neutral" design had a real gap, and fix the interface, don't bolt on a parallel path.

**Before writing any code**: re-verify the vendor research in
`docs/product/FORGE_TRADING_TR1A_VENDOR_DECISION_REVIEW.md` against the vendor's *current* pricing
and licensing pages — do not assume its 2026-09-11 findings (Intrinio preferred, Massive acceptable
fallback, no legally-usable free/trial tier) are still accurate. Prices, plans, and terms can and do
change; a stale research pass presented as current would be exactly the kind of unverified assumption
this whole plan exists to avoid.

**Exclusions**: no watchlist/Brain-Q&A/curriculum UI changes (that already exists from TR-1F-B, and
the order/fill/cash engine already exists from TR-2F — both should work against the newly-added real
instruments without modification, if the adapter interface was designed correctly) — this phase is
the data-source swap only, not a UI or engine rebuild.

**Tests**: security-master invariants for real instruments (symbol identity stability across a
delisting/reuse scenario — synthetic instruments never face this, real ones do); market-data
provenance/timestamp correctness against the real vendor's actual response shape; correction/
restatement handling; adjusted-vs-unadjusted price labeling correctness; RLS tests for every new/
affected table; **a regression test proving TR-1F-B's and TR-2F's existing functionality (curriculum,
Brain Q&A, order/fill/cash ledger) works unmodified against `data_origin='licensed'` instruments** —
this is the actual proof that TR-1F-A's provider-neutral design held up.

**Evidence required**: the specific vendor and plan actually authorized and paid for; confirmation
its current (re-verified, not historical) licensing terms permit the exact ingestion/display used
here; the exact monthly cost and who approved it.

**UX acceptance**: real instruments appear alongside (or replace, per product decision at
authorization time) synthetic ones in the existing watchlist/research UI without any UI code change
beyond what's needed to distinguish `data_origin='licensed'` rows where the design calls for it (e.g.
dropping the training-scenario indicator only for genuinely licensed, real-price surfaces).

**Stop condition**: if no market-data vendor has been authorized/contracted **and separately budget-
approved** yet, stop before writing any ingestion code — this phase cannot proceed on a placeholder
vendor, an assumed budget, or stale pricing research from before this authorization.

---

## TR-2.5 — Brain-generated order proposals

**Scope**: Brain's ability to generate a `trading_order_proposal` (§6/§9) — suggested security,
quantity, order type, rationale, evidence references (into `trading_research_evidence`), assumptions,
and an expiration, always evidence-grounded per §9's citation/abstention rules. The explicit
user-acceptance flow: a human reviews a proposal and, only through a dedicated "accept" action,
causes a **new**, separate RPC call (requiring an authenticated human actor identity, never a
service-role/Brain identity) to create the first `draft` event in `trading_order_events` — the
accepted order then goes through TR-2F's exact same `validated`→`approved` path as any manually-
drafted order, with a `source_proposal_id` reference back to the proposal for auditability.
Deterministic validation of a proposal before it's even shown to the user (reject outright — don't
show — a proposal for an unsupported instrument/order type/quantity).

**Exclusions**: Brain must never be able to call, directly or indirectly, whatever RPC creates a
canonical order — only the human-acceptance RPC can, and it must require a real authenticated human
session. No live broker code. No automatic acceptance of any kind, even for a "safe-looking"
proposal.

**Tests**: prompt-injection tests — a poisoned research document or malicious "evidence" excerpt
cannot cause Brain to create a canonical order (at most, a bad proposal), and cannot escape the
proposal's own data fields to influence anything outside them; structural proof Brain's own
service-role/RPC access cannot call the order-creation RPC under any input (mirroring the Repair
Controller's authority-ceiling test pattern); proposal-expiration enforcement (an expired proposal
cannot be accepted, verified by attempting it and asserting rejection); a rejected/declined proposal
never silently becomes an order later.

**UX acceptance**: a proposal is visually and structurally distinct from an order at every point in
the UI — a user should never be able to mistake "Brain suggested this" for "this is already an
order." The acceptance action is a single, obvious, primary action; expired proposals are clearly
marked as such rather than silently disappearing or remaining actionable.

**Stop condition**: if Brain's proposal-creation pathway and the human's order-creation pathway end
up sharing any code path that could let a proposal silently become an order without the explicit
accept action, stop and report — this is the exact structural boundary that must hold, not a
convention to trust.

---

## TR-3 — Learning, replay, and evaluation

**Scope**: Historical replay/backtest engine (reusing TR-2F's fill contract, run against past data);
strategy definitions and experiment versioning; benchmark comparison; the full metrics suite
(Sharpe, Sortino, profit factor, max drawdown, volatility, win rate, alpha/beta where statistically
valid — §4/§15); transaction-cost/slippage sensitivity analysis; trade journal and Brain-assisted
attribution; the full `lesson → worked example → paper exercise → reflection → concept check` loop
wired end-to-end; behavioral-bias coaching (the 9 biases listed in §10); curriculum modules 5-8;
learning-progress evaluation wired to comprehension/process signals only (never trade
volume/profit — this must be verifiable by inspecting exactly which signals feed the progress
model).

**Exclusions**: no Financial FORGE integration yet (TR-4), no broker connection (TR-5/6).

**Tests**: the AI-specific eval suite from §15 in full — analogy-boundary tests (every parable
response structurally includes its "where this breaks down" clause), bias-intervention tests (the
7 example teaching interactions from the source prompt/§10, each as a real test case), delayed-
retention check correctness, overfitting/small-sample warning triggers on a deliberately
thin-sample backtest fixture; projection-rebuild property test extended to replay-derived
performance metrics, same discipline as TR-2F's (§15).

**UX acceptance**: decision journal and post-trade review clearly separate decision-quality from
outcome-quality (§10) rather than implying a lucky win was a good decision; replay/backtest results
carry explicit small-sample/overfitting warnings rather than presenting a thin backtest as confident
evidence; behavioral-coaching interventions appear contextually (e.g. at the moment of an oversized
concentrated trade) rather than as a disconnected report.

**Stop condition**: if the learning-progress model cannot be cleanly separated from financial data
at the schema level (i.e. it would require joining through a financial table to compute), stop —
this is a hard requirement (§6/§10), not a nice-to-have.

---

## TR-4 — Financial FORGE integration

**Scope**: Investment account projections into the consolidated net-worth view; the summarized-
journal-event posting contract resolved by TR-0.5 and designed in §8; explicit UI/data separation of
simulated vs. actual; reviewed posting/reconciliation contract; Brain cross-domain analysis
(banking/property/private-financing/investments) with authorization/privacy boundaries respected
(reuse existing workspace-membership scoping, do not build a new cross-domain permission model).

**Exclusions**: no broker connection yet (TR-5), still no live trading (TR-6).

**Tests**: a paper account's activity provably never appears in any Financial FORGE net-worth total,
under adversarial test inputs, not just the happy path; idempotent posting (retried posting doesn't
double-count); reconciliation correction produces a new event, never an edit to posted history.

**Stop condition**: if TR-0.5's answer to the ledger-authority question turns out to be wrong or
incomplete once this phase actually integrates against it, stop and report — do not patch around a
wrong assumption silently.

---

## TR-5 — Broker sandbox / read-only adapter

**Scope**: Broker OAuth/token lifecycle (reusing `src/domains/connection/`'s credential-vault
pattern, §12 — do not build a second credential store); capability discovery extending
`connection-capabilities.types.ts`; sandbox and/or read-only account/balance/position/quote/
order-history import for one broker (recommend whichever of E*TRADE or IBKR has the more accessible
sandbox at build time, per §4/§14 — this is a build-time judgment call, not pre-decided here);
normalized provider mapping into the canonical contracts from §6; reconciliation reusing the
payment-webhook idempotency pattern. **No live order submission of any kind, including "just a
test."**

**Exclusions**: TR-6 only.

**Tests**: capability-negotiation correctness (an order type the connected account doesn't support
is rejected at `validated`, never discovered after submission attempt); credential isolation (no
token ever logged, no token accessible outside the connection domain's own boundary); import
idempotency/reconciliation correctness under duplicate/delayed provider data.

**Stop condition**: if implementing this phase would require submitting even a single real test
order to prove the connection works, stop and report — that crosses into TR-6 and needs separate
authorization plus the counsel/compliance gate (§12/Open Decision #2).

---

## TR-6 — Controlled live pilot

**Scope**: Not to be started without: (1) qualified securities counsel/compliance sign-off (§12,
non-negotiable gate, not a checklist item to self-certify); (2) explicit, separate authorization from
Jason beyond whatever authorized TR-0-TR-5. One broker, one account, narrow equity/ETF scope, the
$100-aggregate guardrail as the default policy (§1/§12 — full text, not a paraphrase), no
margin/leverage/options/shorting/automation. Brain proposes, never submits (§9's structural boundary,
already proven in TR-2.5, not built fresh here). Explicit preview/approval, step-up auth, idempotent
execution, kill switch, reconciliation, incident runbook.

**Exclusions**: everything beyond the narrow scope above — options, shorting, margin, multiple
brokers, automation of any kind are explicitly out of scope for this phase and the source
architecture plan agrees they shouldn't even be discussed until this phase proves trustworthy in
production.

**Testing is explicitly three separate things — do not conflate them**:
1. **Automated broker sandbox/certification testing** — safe, repeatable, no real money, run as much
   as needed, standard CI-style regression against the sandbox environment.
2. **Read-only live verification** — confirming the live connection/data path (account, balance,
   position, quote data) works correctly without ever submitting an order.
3. **Exactly one manually-approved, deliberately-scheduled controlled real order** — done once, by a
   human, at a specific planned time — never as part of an automated test run, never repeated
   casually "just to check it still works."

**Reconciliation and containment for that one controlled order**: immediately verify the resulting
fill/position/cash state against the broker's own reporting; have a pre-written incident procedure
ready before the order is placed, not drafted afterward. **A completed live trade cannot be "rolled
back" like a database migration.** If something goes wrong, the only real options are: **contain**
the resulting exposure, **cancel** the order if it's still open (not yet filled), or **execute a
separately-approved corrective transaction** (e.g. a deliberate offsetting trade) — never assume
reversal is possible, and never describe recovery as a "rollback" anywhere in the incident runbook.

**Tests**: full TR-1F-A/TR-1F-B/TR-2F/TR-2.5/TR-5 test suites re-run against the **sandbox/certification** adapter
path (category 1 above — not the live path, and never as an automated live-order test); kill-switch
effectiveness under simulated failure; duplicate-order defense under simulated double-submission;
incident-runbook dry-run (rehearsing contain/cancel/corrective-transaction, not a "rollback" drill).

**Stop condition**: if counsel/compliance sign-off is not documented and attached to the PR, stop —
do not proceed on the assumption that architecture-level safety controls substitute for the actual
legal/compliance gate. Also stop if this phase's plan requires submitting more than the one
deliberately-scheduled controlled order to prove anything — that itself is a sign the sandbox/
certification testing (category 1) was insufficient, and the gap should be closed there, not papered
over with additional live orders.
