"use client";
import { useCallback, useState } from "react";
import { isQuoteExpired } from "@/domains/private-financing/payoffQuote";
import { ADJUSTMENT_ACTION_TYPES } from "@/domains/private-financing/adjustmentActionRegistry";
import { financingPartyLabel } from "@/domains/private-financing/financingPartyLabel";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { ForgeEmptyState, ForgeErrorState, ForgeLoadingState } from "@/components/forge/ForgeStates";
import PrivateFinancingLedgerHistory from "./PrivateFinancingLedgerHistory";
import PrivateFinancingSellerActions from "./PrivateFinancingSellerActions";
import PrivateFinancingExternalPaymentForm from "./PrivateFinancingExternalPaymentForm";
import PrivateFinancingPaymentPolicyControl from "./PrivateFinancingPaymentPolicyControl";
import PrivateFinancingBorrowerInvite from "./PrivateFinancingBorrowerInvite";
import PrivateFinancingOnlinePaymentControl from "./PrivateFinancingOnlinePaymentControl";
import StatusTimeline from "@/components/forge/StatusTimeline";
import { buildFinancingLifecycleSteps } from "@/domains/private-financing/lifecycleTimeline";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const centsToMoney = (cents) => (typeof cents === "number" ? money.format(cents / 100) : "—");
const percent = new Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const bpsToPercent = (bps) => (typeof bps === "number" ? percent.format(bps / 10000) : "—");

const FOCUS_RING = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600";

const PRODUCT_LABELS = { seller_financing: "Seller financing", personal_loan: "Personal loan" };
const POLICY_LABELS = {
  partial_allowed: "Partial payments allowed",
  full_amount_or_more: "Full amount or more",
  exact_amount_only: "Exact amount only",
};
const DAY_COUNT_LABELS = { actual_365: "Actual/365" };
const MEMBERSHIP_STATUS_LABELS = { invited: "Invited", active: "Active", suspended: "Suspended", revoked: "Revoked" };
const ROLE_LABELS = { primary_borrower: "Primary borrower", co_borrower: "Co-borrower", guarantor: "Guarantor" };

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

// The 503 schema-unavailable and 404 not-found responses are not load failures -- they describe the
// environment (feature not activated) or the record (gone / not accessible) -- so the fetcher carries
// them through the data channel as tagged statuses (the error channel only keeps the message string),
// preserving the honest distinctions below.
async function fetchAccountDetail(accountId) {
  const response = await fetch(`/api/private-financing/accounts/${accountId}`);
  const payload = await response.json();
  if (response.status === 503 && payload.code === "private_financing_schema_unavailable") {
    return { status: "schema-unavailable" };
  }
  if (response.status === 404) {
    return { status: "not-found" };
  }
  if (!response.ok) throw new Error(payload.error || "Unable to load this private financing account.");
  return { status: "ok", ...payload };
}

// SF-2A/2C's own read model already computes every figure this component displays (via
// computeAccountBalanceSummary and computeAccountPayoffEstimate, both server-side, both replaying the
// real event history through SF-1's engine). This component only ever renders what the API returned --
// it never calculates a balance, an allocation, or a payoff in React. isQuoteExpired is imported (not
// reimplemented) purely to compare two already-computed date strings for the staleness banner below.
export default function PrivateFinancingAccountDetail({ accountId, onBack }) {
  // Stale-while-revalidate: the last loaded account detail stays on screen while
  // a refresh (seller action, Recalculate, Refresh button) runs in the
  // background -- the screen never blanks to a spinner mid-edit.
  const { data, error: loadError, isLoading, isRefreshing, refresh } = useStaleWhileRevalidate(
    accountId ? `private-financing:account:${accountId}` : null,
    () => fetchAccountDetail(accountId),
    { ttlMs: 60_000 },
  );
  const detail = data?.status === "ok" ? data : null;
  const [prefillReversalTarget, setPrefillReversalTarget] = useState(null);
  const [historyRefreshSignal, setHistoryRefreshSignal] = useState(0);

  const handleReverseRequested = useCallback((eventId) => {
    setPrefillReversalTarget({ actionType: ADJUSTMENT_ACTION_TYPES.PAYMENT_REVERSAL, eventId });
  }, []);
  const handleCorrectRequested = useCallback((eventId) => {
    setPrefillReversalTarget({ actionType: ADJUSTMENT_ACTION_TYPES.COMPENSATING_CORRECTION, eventId });
  }, []);
  // The one requirement this satisfies verbatim: "server reloads authoritative state... UI refetches
  // account detail and history" -- both the balances/components/payoff read model AND the ledger history
  // are re-fetched after any seller action successfully posts, never just one or the other.
  const handlePosted = useCallback(() => {
    refresh();
    setHistoryRefreshSignal((value) => value + 1);
  }, [refresh]);

  return (
    <div data-guided-workflow-panel aria-label="Private financing account detail">
      <button
        type="button"
        data-guided-workflow-control="back-to-list"
        onClick={onBack}
        className={`text-xs font-black uppercase tracking-wide text-slate-500 underline hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 ${FOCUS_RING}`}
      >
        ← Back to accounts
      </button>

      {!data && isLoading ? <div className="mt-4"><ForgeLoadingState label="Loading account details…" /></div> : null}

      {data?.status === "schema-unavailable" ? (
        <div role="alert" className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900/60 dark:bg-amber-950/30">
          <p className="text-sm font-bold text-amber-900 dark:text-amber-200">
            Private Financing has not been activated for this environment yet.
          </p>
          <RetryButton onClick={() => refresh()} />
        </div>
      ) : null}

      {data?.status === "not-found" ? (
        <div className="mt-4">
          <ForgeEmptyState
            headline="This account was not found, or is not accessible to this workspace."
          />
        </div>
      ) : null}

      {!detail && data?.status !== "schema-unavailable" && data?.status !== "not-found" && loadError ? (
        <div className="mt-4" data-guided-workflow-control="retry">
          <ForgeErrorState
            title="Unable to load this account."
            detail={loadError}
            onRetry={() => refresh()}
          />
        </div>
      ) : null}

      {detail ? (
        <div className="mt-4 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-black tracking-tight text-slate-950 dark:text-white">
              {detail.borrowers.length > 0 ? detail.borrowers.map((borrower) => borrower.displayName).join(", ") : "No borrower yet"}
            </h2>
            <button
              type="button"
              data-guided-workflow-control="refresh-account"
              onClick={() => refresh()}
              className={`rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800 ${FOCUS_RING}`}
            >
              Refresh
            </button>
          </div>
          {isRefreshing ? (
            <p role="status" className="text-xs font-bold text-slate-400 dark:text-slate-500">Updating…</p>
          ) : null}
          {loadError ? (
            <p role="status" className="text-xs font-bold text-slate-400 dark:text-slate-500">
              Could not refresh — showing the last saved account details.
            </p>
          ) : null}

          <AccountSummary account={detail.account} balance={detail.balance} dueState={detail.dueState} servicingPolicy={detail.servicingPolicy} />
          <ComponentDetails components={detail.components} balance={detail.balance} />
          <PayoffPresentation payoffEstimate={detail.payoffEstimate} account={detail.account} onRecalculate={() => refresh()} />
          <BorrowerMemberships borrowers={detail.borrowers} />
          <PrivateFinancingBorrowerInvite accountId={accountId} onInvited={() => refresh()} />
          <PrivateFinancingOnlinePaymentControl accountId={accountId} settings={detail.onlinePaymentSettings} onChanged={() => refresh()} />
          {detail.servicingPolicy?.paymentAcceptancePolicy ? (
            <PrivateFinancingPaymentPolicyControl
              accountId={accountId}
              currentPolicy={detail.servicingPolicy.paymentAcceptancePolicy}
              onChanged={handlePosted}
            />
          ) : null}
          <PrivateFinancingExternalPaymentForm
            accountId={accountId}
            components={detail.components}
            onPosted={handlePosted}
          />
          <PrivateFinancingSellerActions
            accountId={accountId}
            product={detail.account.product}
            components={detail.components}
            onPosted={handlePosted}
            prefillReversalTarget={prefillReversalTarget}
          />
          <PrivateFinancingLedgerHistory
            accountId={accountId}
            product={detail.account.product}
            components={detail.components}
            onReverseRequested={handleReverseRequested}
            onCorrectRequested={handleCorrectRequested}
            refreshSignal={historyRefreshSignal}
          />
        </div>
      ) : null}
    </div>
  );
}

function RetryButton({ onClick }) {
  return (
    <button
      type="button"
      data-guided-workflow-control="retry"
      onClick={onClick}
      className={`mt-3 rounded-xl border border-slate-400 px-4 py-2 text-sm font-bold text-slate-800 transition hover:bg-white dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800 ${FOCUS_RING}`}
    >
      Retry
    </button>
  );
}

function Fact({ term, value }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400">{term}</dt>
      <dd className="mt-1 font-bold text-slate-900 dark:text-white">{value}</dd>
    </div>
  );
}

function AccountSummary({ account, balance, dueState, servicingPolicy }) {
  const partyLabel = financingPartyLabel(account.product);
  return (
    <section aria-labelledby="pf-summary-heading" className="rounded-2xl border border-slate-200 p-5 dark:border-slate-700">
      <h3 id="pf-summary-heading" className="text-lg font-black text-slate-950 dark:text-white">Account summary</h3>
      <p className="sr-only">
        A financial summary for this private financing account, including principal, interest, and payment-policy figures.
      </p>
      <div className="mt-4">
        <StatusTimeline heading="Account progress" steps={buildFinancingLifecycleSteps({ status: account.status, openedDate: account.openedDate })} />
      </div>
      <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Fact term="Financing type" value={PRODUCT_LABELS[account.product] || account.product} />
        <Fact term="Original financed principal" value={centsToMoney(account.originationPrincipalCents)} />
        {/* Every component's own remaining principal is shown separately in Loan components below --
            this total is the only cross-component figure shown here, never a blended per-component one. */}
        <Fact term="Current principal remaining" value={centsToMoney(balance?.totalPrincipalRemainingCents)} />
        <Fact term="Principal paid to date" value={centsToMoney(balance?.cumulativeCashPrincipalPaidCents)} />
        <Fact term="Interest paid to date" value={centsToMoney(balance?.cumulativeInterestPaidCents)} />
        <Fact term={`${partyLabel} credits/concessions to date`} value={centsToMoney(balance?.cumulativePrincipalForgivenCents)} />
        {/* The regular payment is a CONTRACTUAL figure, distinct from a calculated present obligation.
            Once an account's own terms are within the due-state engine's V1 support envelope (dueState.js
            -- monthly frequency, a supported prepayment policy), "current amount due"/"past-due amount"/
            "next due date" become real calculated values; otherwise they stay honestly "Not tracked yet." */}
        <Fact term="Regular scheduled payment" value={centsToMoney(balance?.regularScheduledPaymentCents)} />
        <Fact term="Current amount due" value={dueState ? centsToMoney(dueState.currentAmountDueCents) : "Not tracked yet"} />
        <Fact term="Past-due amount" value={dueState ? centsToMoney(dueState.pastDueAmountCents) : "Not tracked yet"} />
        <Fact term="Next due date" value={dueState ? dueState.nextDueDate : "Not tracked yet"} />
        <Fact term="Payment-acceptance policy" value={servicingPolicy ? (POLICY_LABELS[servicingPolicy.paymentAcceptancePolicy] || servicingPolicy.paymentAcceptancePolicy) : "Not set"} />
        <Fact term="Late fees" value={account.lateFeePolicy === "disabled" ? "No late fees" : "Enabled"} />
      </dl>
    </section>
  );
}

// V1 Terms Generalization: components render dynamically from whatever ordered collection this account
// actually has -- one or more, never assuming exactly two or any fixed named identity. Rate and each
// component's own terms determine what's shown, never a hard-coded "interest-bearing"/"zero-interest"
// label pair.
function ComponentDetails({ components, balance }) {
  return (
    <section aria-labelledby="pf-components-heading" className="rounded-2xl border border-slate-200 p-5 dark:border-slate-700">
      <h3 id="pf-components-heading" className="text-lg font-black text-slate-950 dark:text-white">Loan components</h3>
      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
        Each component is shown separately -- never combined into one blended figure.
      </p>
      <ul className="mt-4 space-y-3">
        {components.map((component) => (
          <li key={component.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
            <p className="font-black text-slate-950 dark:text-white">
              {component.label} · {bpsToPercent(component.rateBps)}
            </p>
            <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Fact term="Original principal" value={centsToMoney(component.originalPrincipalCents)} />
              <Fact term="Current principal" value={centsToMoney(balance?.remainingPrincipalByComponentCents?.[component.componentKey])} />
              <Fact term="Rate" value={bpsToPercent(component.rateBps)} />
              <Fact term="Day-count method" value={DAY_COUNT_LABELS[component.dayCountConvention] || component.dayCountConvention} />
              <Fact term="Scheduled component amount" value={centsToMoney(component.scheduledComponentAmountCents)} />
              <Fact term="Effective terms" value={`Version ${component.versionNumber} · ${component.effectiveDate}`} />
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PayoffPresentation({ payoffEstimate, account, onRecalculate }) {
  if (!payoffEstimate) {
    // A late-fee-enabled account is a real, lawful configuration V1 simply cannot calculate a payoff for
    // yet (no late-charge engine exists) -- this is told to the seller/lender honestly, distinct from the
    // ordinary "no history yet / already closed" case, rather than folding both into one vague message.
    const lateFeesUnsupported = account?.lateFeePolicy && account.lateFeePolicy !== "disabled";
    return (
      <section aria-labelledby="pf-payoff-heading" className="rounded-2xl border border-slate-200 p-5 dark:border-slate-700">
        <h3 id="pf-payoff-heading" className="text-lg font-black text-slate-950 dark:text-white">Payoff estimate</h3>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          {lateFeesUnsupported
            ? "No payoff estimate is available -- this account's late-fee policy is enabled, and late-charge calculation is not yet supported."
            : "No payoff estimate is available -- the account has no balance history yet, or is already closed."}
        </p>
      </section>
    );
  }
  const stale = isQuoteExpired(payoffEstimate, todayISODate());
  return (
    <section aria-labelledby="pf-payoff-heading" className="rounded-2xl border border-slate-200 p-5 dark:border-slate-700">
      <h3 id="pf-payoff-heading" className="text-lg font-black text-slate-950 dark:text-white">Payoff estimate</h3>
      {stale ? (
        <p role="alert" className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-bold text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          This estimate may be out of date. Refresh to recalculate.
        </p>
      ) : null}
      <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Fact term="Calculated through" value={payoffEstimate.calculatedThroughDate} />
        <Fact term="Total principal" value={centsToMoney(payoffEstimate.totalPrincipalCents)} />
        <Fact term="Accrued interest" value={centsToMoney(payoffEstimate.accruedInterestCents)} />
        <Fact term="Authorized additional amounts" value={centsToMoney(payoffEstimate.authorizedAdditionalAmountsCents)} />
        <Fact term="Late charges" value={centsToMoney(payoffEstimate.lateChargesCents)} />
        <Fact term="Calculated payoff" value={centsToMoney(payoffEstimate.calculatedPayoffCents)} />
        <Fact term="Recalculate after" value={payoffEstimate.expirationDate} />
      </dl>
      <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">{payoffEstimate.estimateDisclaimer}</p>
      <button
        type="button"
        data-guided-workflow-control="recalculate-payoff"
        onClick={onRecalculate}
        className={`mt-3 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800 ${FOCUS_RING}`}
      >
        Recalculate
      </button>
    </section>
  );
}

function BorrowerMemberships({ borrowers }) {
  return (
    <section aria-labelledby="pf-borrowers-heading" className="rounded-2xl border border-slate-200 p-5 dark:border-slate-700">
      <h3 id="pf-borrowers-heading" className="text-lg font-black text-slate-950 dark:text-white">Borrowers</h3>
      {borrowers.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">No borrower has been added to this account yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {borrowers.map((borrower) => (
            <li key={borrower.membershipId} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <p className="font-bold text-slate-950 dark:text-white">{borrower.displayName}</p>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                {ROLE_LABELS[borrower.role] || borrower.role} · {MEMBERSHIP_STATUS_LABELS[borrower.status] || borrower.status}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
