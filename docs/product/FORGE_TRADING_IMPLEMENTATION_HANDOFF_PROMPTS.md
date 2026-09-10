# FORGE Trading: Claude Implementation Handoff Prompts

**Revised** 2026-09-10 incorporating ChatGPT's architecture review: TR-1 split into TR-1A/TR-1B, a
new TR-2.5 (Brain order proposals) added, TR-0/TR-0.5's relationship to TR-4 (not TR-2) corrected,
TR-6's live-testing language and rollback framing corrected, UX acceptance criteria added per phase.
See the companion architecture doc's own revision note for the full list.

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
acceptance criteria and test strategy for TR-1.

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
does not block TR-1A, TR-1B, TR-2, TR-2.5, or TR-3. TR-0.5 is the phase that actually resolves it,
required only before TR-4. Stop and report only if you cannot even characterize the ambiguity from
repository evidence (i.e. you can't tell what's genuinely unclear) — don't guess at a resolution here.

---

## TR-0.5 — Ledger-authority spike

**Scope**: Determine, with actual evidence (which code paths write to `src/domains/ledger/`'s
`JournalEntry`/`Posting`/`GeneralLedger` entities today, if any; which routes/services are wired to
them; whether they're live, dormant, or superseded by the event-sourced `financial_events`/
`private_financing_events` pattern), which structure is Financial FORGE's actual authoritative
general ledger today. This single question locks §8 of the architecture plan's TR-4 integration
contract. **It does not block TR-1A, TR-1B, TR-2, TR-2.5, or TR-3** — those phases have no
dependency on this answer, since the trading domain's own event-sourced design stays independently
correct regardless of which ledger structure this resolves to. Can run any time before TR-4 starts.

**Exclusions**: No design changes to either structure. No code written beyond a throwaway
investigation script if needed (not committed).

**Evidence required**: a clear, cited answer — "X is authoritative because Y is the only thing that
writes to it and Z reads from it in production" or equivalent — not a guess.

**Stop condition**: if the evidence is genuinely ambiguous (e.g. both are partially wired), stop and
present the ambiguity to Jason rather than picking one to move forward with.

---

## TR-1A — Security master and market data

**Scope**: Security master for a small fixed symbol set (propose ~10-20 well-known large-cap
symbols, not a full exchange listing) — `trading_instruments` per §6 of the architecture plan; vendor
mapping layer (FORGE instrument ID ↔ vendor's own symbol/identifier scheme); delayed/EOD market-data
ingestion with explicit `effective_at` **and** `received_at` timestamps on every quote (§6);
adjusted-vs-unadjusted price labeling; corrections/restatements from the vendor land as new,
timestamped rows, never in-place edits (§6). **No UI beyond what's needed to prove ingestion
correctness in tests — the actual quote display/chart is TR-1B's job**, keeping this slice isolated
to the market-data risk itself.

**Exclusions**: no watchlist, no Brain Q&A, no curriculum, no order ticket, no trading account, no
fill engine, no brokerage connection code at all — not even a stub.

**Tests**: security-master invariants (symbol identity stability across a delisting/reuse scenario);
market-data provenance/timestamp correctness (`effective_at` vs `received_at` distinctly asserted);
correction/restatement handling (a corrected quote produces a new row, never mutates the original);
adjusted-vs-unadjusted price labeling correctness; RLS tests for every new table (workspace/
acting-user pattern, not direct-owner).

**Evidence required**: which market-data vendor was actually wired (must match whatever TR-0
resolved, §14/Open Decision #1) and confirmation its licensing terms permit the exact ingestion/
storage used here.

**UX acceptance**: none beyond test-only data displays — TR-1A produces no end-user-facing UI.

**Stop condition**: if no market-data vendor has been authorized/contracted yet, stop before writing
any ingestion code — this phase cannot proceed on a placeholder vendor and be trusted later.

---

## TR-1B — Watchlist, research, and Brain Q&A

**Scope**: Watchlist (`trading_watchlist_items` per §6) over TR-1A's security master; basic quote
display + a simple price/volume chart (no technical-indicator charting) surfacing TR-1A's data; a
research-evidence store (`trading_research_evidence` per §6 — apply its licensing discipline: store
references/hashes/permitted excerpts, never assume wholesale retention rights); read-only Brain Q&A
with citations (extends the Engineering-Brain citation contract shape, but is a genuinely new
end-user-facing route — do not touch `src/app/api/forge/engineering-brain/*`, which stays
developer-only); contextual help (§11's information hierarchy); curriculum modules 1-4 with concept
checks, using the resolved deterministic answer-key mechanism (§10/§16 — not a Brain-graded check).
**No orders of any kind, paper or live.**

**Exclusions**: no order ticket, no trading account, no fill engine, no brokerage connection code at
all — not even a stub. Depends on TR-1A having already landed (do not re-implement or duplicate
market-data ingestion here).

**Tests**: citation-or-abstain behavior for Brain Q&A (the abstention path must have a real test, not
just the happy path); the first 4 curriculum modules' concept-check grading logic (asserting the
deterministic answer key, not Brain-authored grading); RLS tests for every new table; guided-vs-expert
mode test asserting both routes through identical validation (§11).

**Evidence required**: confirmation TR-1A's licensing terms permit the exact display used here (quote
display, chart, any excerpt shown from research evidence).

**UX acceptance**: watchlist, security detail/research view, and curriculum lesson screens match §11's
information hierarchy (plain meaning → practical consequence → technical name → example/parable →
evidence on demand); contextual help triggers correctly on first use/unfamiliar term/explicit
"Explain this"; guided and expert modes present differently but validate identically.

**Stop condition**: if TR-1A's data isn't actually available/trustworthy yet (vendor licensing
unresolved, ingestion not proven), stop rather than building against placeholder data.

---

## TR-2 — Paper account and deterministic order ledger

**Scope**: Paper `trading_accounts` (mode-immutable, per §6/§12); equity/ETF order ticket (market/
limit/stop/stop-limit, day/GTC); the canonical order state machine including the **replace
relationship** (a cancel/replace creates a new order with `replaces_order_id`, never a same-order
`replaced → open` transition — §5.2) and immutable `trading_order_events` (§5.2/§6), each event
carrying the provider's raw payload (`raw_provider_payload`) alongside FORGE's normalized fields;
deterministic risk-policy validation at `validated`; the `v1` versioned fill simulator (§7) with
bid/ask-aware pricing where available, explicit spread/slippage fallback otherwise, and workflow-
specific stale-quote thresholds (§7); **fill events inside `trading_order_events` are the sole
authoritative fill truth** — `trading_fills`, positions, lots, and P&L are all rebuildable
projections carrying `source_event_id` (§6), never a second copy of truth; the `trading_cash_events`
stream (§6) as the sole source of cash truth (deposits, withdrawals, reserved buying power,
unsettled proceeds, fees) with available cash computed as a projection over it, never an
independently-mutated balance; confirmations and statements. Curriculum's order-ticket just-in-time
teaching hooks (not full modules 5-8 yet).

**Exclusions**: no live broker code, no Financial FORGE posting yet (§8 — that's TR-4), no
replay/backtest engine yet (TR-3), no Brain order-proposal UI or acceptance flow yet (that's TR-2.5,
which depends on this phase's order contract already existing).

**Tests**: full order-lifecycle state-machine coverage (every transition in §5.2's diagram, including
the disallowed ones — e.g. a `filled` order cannot receive a new `canceled` event); the
cancel/replace race (original order fills while `replacement_requested`, and the new order is
correctly treated as never-submitted/canceled per the adapter's actual response); fill-policy
determinism (same inputs, same fill, every run); look-ahead prevention (§7) with a golden fixture
that would fail under a naive "peek at future price" implementation; idempotency under retried
order-submission; cross-account/cross-workspace denial; paper-mode immutability (`mode` cannot
change, verified by attempting it and asserting rejection); **projection-rebuild property test**:
delete `trading_fills`/positions/cash-balance projections and rebuild them from
`trading_order_events`/`trading_cash_events` alone, assert identical results (§15).

**UX acceptance**: order ticket reveals advanced settings only when selected while material
consequences (cost, cash impact, risk flags) stay always visible; the plain-language review sentence
appears before the technical order summary (§11); paper/live mode indicator is unmistakable in the
account switcher and order ticket header; guided and expert modes validate identically (§11).

**Stop condition**: if the risk-policy engine's rules can't be made fully deterministic (e.g.
require an LLM judgment call anywhere in the validation path), stop and report — this violates a
hard architecture requirement (§9/§16), not a preference.

---

## TR-2.5 — Brain-generated order proposals

**Scope**: Brain's ability to generate a `trading_order_proposal` (§6/§9) — suggested security,
quantity, order type, rationale, evidence references (into `trading_research_evidence`), assumptions,
and an expiration, always evidence-grounded per §9's citation/abstention rules. The explicit
user-acceptance flow: a human reviews a proposal and, only through a dedicated "accept" action,
causes a **new**, separate RPC call (requiring an authenticated human actor identity, never a
service-role/Brain identity) to create the first `draft` event in `trading_order_events` — the
accepted order then goes through TR-2's exact same `validated`→`approved` path as any manually-
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

**Scope**: Historical replay/backtest engine (reusing TR-2's fill contract, run against past data);
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
performance metrics, same discipline as TR-2's (§15).

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

**Tests**: full TR-2/TR-2.5/TR-5 test suites re-run against the **sandbox/certification** adapter
path (category 1 above — not the live path, and never as an automated live-order test); kill-switch
effectiveness under simulated failure; duplicate-order defense under simulated double-submission;
incident-runbook dry-run (rehearsing contain/cancel/corrective-transaction, not a "rollback" drill).

**Stop condition**: if counsel/compliance sign-off is not documented and attached to the PR, stop —
do not proceed on the assumption that architecture-level safety controls substitute for the actual
legal/compliance gate. Also stop if this phase's plan requires submitting more than the one
deliberately-scheduled controlled order to prove anything — that itself is a sign the sandbox/
certification testing (category 1) was insufficient, and the gap should be closed there, not papered
over with additional live orders.
