# FORGE Trading TR-0.5: Financial FORGE Ledger-Authority Investigation

**Status:** Evidence-gathering and documentation only. No product code, schema, migration, ledger
repair/backfill, Trading implementation, provider selection/purchase, or deployment was performed.
Nothing here was merged.
**Prepared:** 2026-09-10, against `origin/main` (tip at time of writing includes PR #157, #158, #159).
**Companion documents:** `docs/product/FORGE_TRADING_ARCHITECTURE_AND_PHASED_PLAN.md` §2/§8/§13,
`docs/product/FORGE_TRADING_IMPLEMENTATION_HANDOFF_PROMPTS.md` (TR-0.5's own prompt, followed here),
`docs/product/FORGE_TRADING_TR0_DISCOVERY_AND_CONTRACTS.md` §7 (the ambiguity this phase resolves).

**Evidence discipline** (same convention as TR-0): 🟢 verified repository fact (exact path/symbol,
read directly) · 🟡 architectural recommendation, labeled as such · 🔒 unresolved, needs further
input.

---

## 1. Conclusion (not hedged — the evidence supports a clear answer)

**`financial_events` (and its private-financing-domain extension, `private_financing_events`) is
Financial FORGE's authoritative financial-event source of truth. `src/domains/ledger/`'s classical
double-entry structures (`GeneralLedger`, `JournalEntry`, `Posting`, `ChartOfAccounts`), as currently
wired in production, are NOT authoritative — they are an unfinished/demo-only reporting subsystem.**

This is not a case of genuinely split or ambiguous authority between two live systems that might
disagree. It is a case where TR-0 correctly observed that both structures are *referenced by real
code* — but reading what that code actually *does* at runtime shows only one of them is fed real
data. The distinction TR-0 itself established (§1: "real code that compiles and has tests" can still
be dormant/non-authoritative) applies directly here.

---

## 2. Evidence chain

### 2.1 `src/domains/ledger/`'s core repository interface has no real implementation

🟢 `src/domains/ledger/repositories/GeneralLedgerRepository.js` is an explicit interface —
its own docblock states: *"Infrastructure implementations (Supabase, Postgres, etc.) must implement
this interface"* — with both `load()` and `save()` throwing `Not implemented`. A repo-wide search
(`grep -rln "extends GeneralLedgerRepository\|extends LedgerRepository" src/`) finds **exactly two
implementations, both in-memory**: `InMemoryGeneralLedgerRepository.js`, `InMemoryLedgerRepository.js`.
No Supabase/Postgres implementation of these two interfaces exists anywhere in the codebase.

### 2.2 The classical ledger's actual production data source is a stub that throws

🟢 `src/domains/ledger/providers/ProductionFinancialDataProvider.js`, in full:

```js
export class ProductionFinancialDataProvider extends FinancialDataProvider {
  getFinancialData() {
    throw new Error("ProductionFinancialDataProvider is not implemented yet");
  }
}
```

This is the class whose *name* is the strongest a priori signal that the classical ledger has a real
production path — and it is an unimplemented stub.

### 2.3 The real composition wiring always falls back to demo data, unconditionally

🟢 `src/infrastructure/composition/createFinancialApplicationSuite.js` (the single real composition
root behind every authenticated financial API route — confirmed its only two real callers are
`createForgeApplicationSuite.js` and `src/lib/supabase/createAuthenticatedFinancialApplication.js`,
neither of which passes a `financialData` override):

```js
const financialData =
  deps.financialData || new DemoFinancialDataProvider().getFinancialData();

const engine =
  deps.engine ||
  new FinancialEngine({
    generalLedger: deps.generalLedger || financialData.generalLedger,
    chartOfAccounts: deps.chartOfAccounts || financialData.chartOfAccounts,
  });
```

Unlike several *other* repository selections in this same file (`financialAccountRepositoryStorage`,
`accountBalanceRepositoryStorage`, and `createFinancialEventRepository`'s own storage mode all check
a `process.env.*_REPOSITORY` variable before defaulting to memory), **this specific line has no
environment-variable gate at all.** There is no way to configure this into using real data today —
not a misconfigured flag, an absent implementation.

🟢 `src/domains/ledger/providers/DemoFinancialDataProvider.js`'s own docblock: *"Supplies stable demo
financial data for local development, API wiring, dashboard previews, and smoke tests."* Its backing
data (`demoFinancialData.js`) is five hard-coded accounts with fixed dollar amounts (Cash $10,000,
Accounts Receivable $2,500, Debt Owed $4,000, Monthly Revenue $12,000, Monthly Expenses $8,500) —
static test fixture data, not derived from any real account.

### 2.4 This reaches two real, authenticated, deployed production API routes

🟢 `src/app/api/financial/reports/route.ts` (`GET`, real authenticated route via
`createAuthenticatedFinancialApplication` — 401s without a real signed-in user) calls
`reportingApplication.buildDashboardReports()`. `reportingApplication` is constructed directly from
the demo-fed `engine`/`dashboardService` above — no other data source.

🟢 `src/app/api/financial/snapshot/route.ts` calls
`snapshotApplication.captureDashboardSnapshot()`, same demo-fed dependency chain via
`createFinancialSnapshotApplication`'s own default (`options.provider || new
DemoFinancialDataProvider()`).

**Severity context, not just the raw fact**: 🟢 a repo-wide search of `src/components/` and
`src/app/forge/` found **zero** frontend callers of `/api/financial/reports` or
`/api/financial/snapshot` — these routes are real, deployed, and would currently return demo data to
any authenticated caller, but nothing in the product UI currently calls them. This is a materially
different risk than "a page real users look at today is showing fake numbers" — it's closer to
"orphaned infrastructure that would silently mislead a user if it were ever wired into the UI without
this being noticed first." Both characterizations matter; neither should be dropped in retelling this
finding.

### 2.5 `financial_events` is real, independently proven by this session's own production reads — multiple times, in a different investigation each time

🟢 This is not a new finding of this phase — it's the accumulated evidence from three separate,
independent audits earlier in this same session, each of which read real rows directly from
production via `supabase db query --linked`:

- The rental payment-chain audit found real `financial_events` rows agreeing exactly (to the cent)
  with real `rental_payments`/`rent_charges` rows, including a live-verified refund that produced an
  exact offsetting `-$1.00` entry via `reconcile_rental_payment_reversal_trigger`.
- The private-financing borrower-summary investigation (PR #154) found and fixed a real read-model
  bug specifically because `private_financing_events` (the same event-sourced pattern) already held
  correct ledger truth that a *different* code path was failing to summarize correctly — the ledger
  itself was never in question, only a display layer reading it.
- The production `service_role` grants audit confirmed `financial_events`-adjacent tables have real,
  correct RLS/grants in production, not just in migration files.

No comparably-grounded production evidence exists for `src/domains/ledger/`'s classical structures —
because, per §2.1-§2.4 above, there is no live write path to them to even audit.

### 2.6 Who actually reads/writes each structure — the exhaustive caller list

🟢 `src/domains/ledger/` real (non-test) callers, confirmed via `git grep`:
`createFinancialSnapshotApplication.js`, `createFinancialSnapshotRepository.js`,
`createFinancialApplicationSuite.js`, `src/domains/audit/AutonomousAuditAgent.js` (reads via the
dashboard/trace services, not an independent writer), `src/application/financial/FinancialSnapshotViewApplication.js`.
All of these either construct the demo-fed `engine`, or read/write `FinancialSnapshot` — a **cached
report artifact**, not a ledger of financial facts (see §3 below for the distinction).

🟢 `financial_events` / `private_financing_events` real callers: the entire rental Stripe webhook
chain (`process_stripe_rental_payment_event` RPC → `post_succeeded_rental_payment_to_financial_event`
trigger, both independently verified live in production this session), the entire private-financing
event/replay chain (`replayEvents.js`, `dueState.js`, the Stripe payment RPCs), `src/domains/financial-event/`'s
`FinancialEventGateway`/`Repository`/`Translator` layer (backing `financialWorkspaceQueryService` →
`readModelApplication`, itself consumed by `/api/financial/read-models`, `/api/financial/explain`,
`/api/financial/trace`, `/api/financial/operations`), and `src/domains/financial-import/`-adjacent
import paths.

---

## 3. Distinguishing the categories the handoff prompt asked for

| Structure | Category |
|---|---|
| `financial_events` / `private_financing_events` | **Authoritative financial truth.** Append-only, RPC/trigger-written, independently verified against real production rows multiple times this session. |
| `src/domains/ledger/`'s `GeneralLedger`/`JournalEntry`/`Posting`/`ChartOfAccounts` (via `FinancialEngine`) | **Not an active production path today.** Real code, real tests, but its only production data source (`ProductionFinancialDataProvider`) is an unimplemented stub; every real caller falls back to hard-coded demo data unconditionally. |
| `FinancialSnapshot` (`src/domains/ledger/snapshots/`) | **A cached report/projection artifact**, not a ledger — and today, a projection *over demo data*, not over `financial_events`. If the classical ledger's data source were ever completed, `FinancialSnapshot` would remain correctly categorized as a projection/read-model, never a second source of truth — this categorization itself does not need to change, only its current input. |
| `readModelApplication` / `financialWorkspaceQueryService` (financial-event-repository-backed) | **Active production read model**, correctly a projection over `financial_events`, not competing truth. |
| `investment_accounts` / `investment_account_valuations` (per the architecture plan's §2, already classified) | **Domain subledger truth** for account-level net-worth valuations specifically — separate concern, not in conflict with this finding. |

**No dual-write or disagreement risk exists today** between `financial_events` and the classical
ledger, for the simple reason that the classical ledger has no real write path to disagree *with*
real data — it disagrees with reality by construction (it's demo data), not by drift between two live
systems. This is a materially better finding for TR-4's design than "two systems that could silently
diverge" would have been — but see §5 for the separate, real risk this phase did find.

---

## 4. TR-4 integration recommendation: revised, not merely confirmed

The architecture plan's §8 currently reads (conditional, pending this phase): *"Financial FORGE's
ledger (whichever of `src/domains/ledger/`'s classical GL or the event-sourced pattern is confirmed
authoritative...) should receive periodic, idempotent summarized postings."*

🟡 **Revision**: replace "whichever...is confirmed authoritative" with a direct statement —
**`financial_events` is the authoritative target.** A future TR-4 implementation should post
summarized trading journal events (cash movements, realized P&L, fees, dividends) as new rows in
`financial_events`, using the same idempotency discipline already proven in this codebase (a stable
`source_reference`/idempotency key per summarized posting, `SECURITY DEFINER` RPC scoped to
`service_role`, RLS force-enabled — mirroring the exact pattern independently verified in the
private-financing and rental payment chains this session). **Do not post to `src/domains/ledger/`'s
structures** — there is no live infrastructure there to receive a real posting today, and building one
solely for Trading would create the exact competing-ledger risk the architecture plan was trying to
avoid, not prevent it.

The rest of §8's contract (paper activity never posts; live activity posts summarized, not raw,
events; FIFO/broker-reported-lots cost-basis handling; reconciliation reuses the
connection-execution-history + payment-webhook idempotency pattern) **needs no revision** — it was
already written in a way that's agnostic to which specific ledger structure the answer turned out to
be, and `financial_events` fits that contract directly.

---

## 5. Unresolved risk found along the way (separate from Trading, but discovered because of this investigation)

🔒 **`/api/financial/reports` and `/api/financial/snapshot` are real, deployed, authenticated
production API routes currently returning hard-coded demo financial data, not the requesting user's
real data.** No frontend component currently calls either route (§2.4), which limits — but does not
eliminate — the practical exposure: any authenticated user who discovered and called either endpoint
directly today would receive fabricated financial figures attributed implicitly to their own account
context (the routes are owner-scoped via real auth, but the *data* returned is the same static demo
fixture for every caller). This is **not a Trading-program concern** and this phase has no
authorization to fix it — flagging it here because it was discovered as a direct consequence of
tracing exactly the question TR-0.5 was asked to answer, and it would be a disservice to bury it in a
"no risks found" summary. Recommend a separate, small, non-Trading investigation/fix slice, engineering-
resolvable (complete `ProductionFinancialDataProvider` to read real `financial_events`-derived data,
or remove/gate the two routes if they're genuinely unused scaffolding) — this does not need Jason's
product-direction input, just a bounded authorization to fix it.

---

## 6. What this TR-0.5 pass did not do (explicitly out of scope, confirmed)

No design change was made to either `src/domains/ledger/` or `financial_events`. No product code was
written (this document is the only output). No schema or migration was created or applied. No ledger
repair or backfill occurred. No Trading implementation code was written. No provider was selected or
purchased. No production data was mutated — every finding above came from reading source files in a
local worktree; **no `supabase db query --linked` or equivalent production access was needed or used
for this phase** (the question was fully resolvable from repository evidence alone, per the handoff
prompt's own preference for that outcome — production reads were reserved for the three *prior*
sessions'-worth of independent evidence cited in §2.5, not repeated here). Nothing was deployed.
Nothing was merged — delivered as an open, unmerged PR per the handoff prompt's requirement.
