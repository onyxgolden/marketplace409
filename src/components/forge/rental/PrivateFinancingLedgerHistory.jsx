"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { financingPartyLabel } from "@/domains/private-financing/financingPartyLabel";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { ForgeEmptyState, ForgeErrorState, ForgeLoadingState } from "@/components/forge/ForgeStates";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const centsToMoney = (cents) => (typeof cents === "number" ? money.format(cents / 100) : "—");

const EMPTY_EVENTS = [];

const FOCUS_RING = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600";

const EVENT_TYPE_LABELS = {
  account_opened: "Account opened",
  payment_posted: "Payment posted",
  payment_reversal: "Payment reversed",
  principal_correction: "Principal correction",
  interest_correction: "Interest correction",
  compensating_correction: "Compensating correction",
  payoff_concession: "Payoff concession",
  account_closed: "Account closed",
};

// Plain-language origin labels -- distinguishes imported, external, interactive, and (not yet used in
// this repo) provider-originated events, per requirement 5. stripe_webhook has no live caller anywhere
// in SF-1/SF-2 yet (see the governance handoff's own "no Stripe activation" boundary) but is labeled here
// so the ledger never renders a raw enum value if one ever appears. A function of partyLabel ("Seller" or
// "Lender," per financingPartyLabel.js) since who "recorded" or "confirmed" an event is named differently
// depending on the account's own financing type.
function eventOriginLabels(partyLabel) {
  return {
    interactive_user: `Recorded live by ${partyLabel.toLowerCase()}`,
    manual_import: "Imported historical record",
    manual_external: `${partyLabel}-confirmed external payment`,
    stripe_webhook: "Online payment (provider-originated)",
  };
}

const PAYMENT_METHOD_LABELS = {
  venmo: "Venmo", cash_app: "Cash App", zelle: "Zelle", paypal: "PayPal",
  bank_transfer: "Bank transfer", cash: "Cash", check: "Check", money_order: "Money order", other: "Other",
};

// V1 Terms Generalization: renders whatever componentKeys this event's own allocation actually touched --
// one or more, never assuming exactly two fixed named components. componentLabelsByKey resolves a
// display label from the account's own real components; falls back to the raw key if a component's label
// isn't available (e.g. it was later removed from a version this account no longer shows as current).
function PaymentExplanation({ event, componentLabelsByKey }) {
  const [expanded, setExpanded] = useState(false);
  const labelFor = (componentKey) => componentLabelsByKey?.[componentKey] || componentKey;
  const interestEntries = Object.entries(event.interestPaidByComponentCents || {});
  const principalEntries = Object.entries(event.principalPaidByComponentCents || {});
  const remainingEntries = Object.entries(event.principalRemainingByComponentCents || {});
  return (
    <div className="mt-2">
      <button
        type="button"
        data-guided-workflow-control="toggle-payment-explanation"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className={`text-xs font-bold text-sky-700 underline hover:text-sky-800 dark:text-sky-400 dark:hover:text-sky-300 ${FOCUS_RING}`}
      >
        {expanded ? "Hide how this was applied" : "How was this applied?"}
      </button>
      {expanded ? (
        <dl className="mt-2 grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-950/40 sm:grid-cols-2">
          <ExplanationFact term="Amount received" value={centsToMoney(event.amountCents)} />
          {interestEntries.map(([componentKey, cents]) => (
            <ExplanationFact key={`interest-${componentKey}`} term={`Interest applied — ${labelFor(componentKey)}`} value={centsToMoney(cents)} />
          ))}
          {principalEntries.map(([componentKey, cents]) => (
            <ExplanationFact key={`principal-${componentKey}`} term={`Principal applied — ${labelFor(componentKey)}`} value={centsToMoney(cents)} />
          ))}
          {typeof event.unallocatedCents === "number" && event.unallocatedCents > 0 ? (
            <ExplanationFact term="Unapplied / refundable amount" value={centsToMoney(event.unallocatedCents)} />
          ) : null}
          {remainingEntries.map(([componentKey, cents]) => (
            <ExplanationFact key={`remaining-${componentKey}`} term={`${labelFor(componentKey)} balance after`} value={centsToMoney(cents)} />
          ))}
          <div className="sm:col-span-2">
            <dt className="font-bold uppercase text-slate-500 dark:text-slate-400">Why this allocation</dt>
            <dd className="mt-1 text-slate-700 dark:text-slate-300">
              Interest already accrued is paid first, then each component&apos;s own scheduled amount in the
              account&apos;s configured order, then anything extra follows the account&apos;s own extra-payment policy.
            </dd>
          </div>
        </dl>
      ) : null}
    </div>
  );
}

function ExplanationFact({ term, value }) {
  return (
    <div>
      <dt className="font-bold uppercase text-slate-500 dark:text-slate-400">{term}</dt>
      <dd className="mt-0.5 font-bold text-slate-900 dark:text-white">{value}</dd>
    </div>
  );
}

// Mirrors ledgerIntegrity.js's own REVERSAL_TARGET_TYPES mapping: only these event types can ever be the
// target of a compensating_correction. Kept in sync deliberately rather than imported, since this is a
// UI-only "should we even offer the button" hint -- the server re-validates the real rule regardless.
const COMPENSATING_CORRECTION_TARGET_TYPES = new Set(["principal_correction", "interest_correction", "payoff_concession"]);

function LedgerEventRow({ event, alreadyReversed, onReverseRequested, onCorrectRequested, partyLabel, componentLabelsByKey }) {
  const isPayment = event.eventType === "payment_posted" || event.eventType === "payment_reversal";
  const isCorrection = ["principal_correction", "interest_correction", "compensating_correction", "payoff_concession"].includes(event.eventType);
  const canReverse = event.eventType === "payment_posted" && !alreadyReversed && Boolean(onReverseRequested);
  const canCorrect = COMPENSATING_CORRECTION_TARGET_TYPES.has(event.eventType) && !alreadyReversed && Boolean(onCorrectRequested);
  return (
    <li className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-bold text-slate-950 dark:text-white">
          {EVENT_TYPE_LABELS[event.eventType] || event.eventType} · {event.effectiveDate}
        </p>
        {typeof event.amountCents === "number" ? (
          <p className="font-black text-slate-950 dark:text-white">{centsToMoney(event.amountCents)}</p>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
        {eventOriginLabels(partyLabel)[event.eventOrigin] || event.eventOrigin}
        {event.paymentMethod ? ` · ${PAYMENT_METHOD_LABELS[event.paymentMethod] || event.paymentMethod}` : ""}
      </p>
      {event.reversesEventId ? (
        <p className="mt-1 text-xs font-bold text-amber-800 dark:text-amber-300">Reverses/corrects a prior event.</p>
      ) : null}
      {isCorrection && typeof event.deltaCents === "number" ? (
        <p className="mt-1 text-xs text-slate-700 dark:text-slate-300">
          {partyLabel} credit/concession: {centsToMoney(Math.abs(event.deltaCents))}
        </p>
      ) : null}
      {event.eventType === "payoff_concession" && event.deltaCentsByComponentCents ? (
        <p className="mt-1 text-xs text-slate-700 dark:text-slate-300">
          {partyLabel} credit/concession: {centsToMoney(Object.values(event.deltaCentsByComponentCents).reduce((sum, cents) => sum + Math.abs(cents), 0))}
        </p>
      ) : null}
      {event.borrowerVisibleExplanation ? (
        <p className="mt-1 text-xs text-slate-700 dark:text-slate-300">Borrower-visible note: {event.borrowerVisibleExplanation}</p>
      ) : null}
      {event.internalNote ? (
        <p className="mt-1 text-xs italic text-slate-500 dark:text-slate-500">{partyLabel}-only note: {event.internalNote}</p>
      ) : null}
      {isPayment ? <PaymentExplanation event={event} componentLabelsByKey={componentLabelsByKey} /> : null}
      {canReverse || canCorrect ? (
        <div className="mt-2 flex flex-wrap gap-3">
          {canReverse ? (
            <button
              type="button"
              data-guided-workflow-control="reverse-payment-from-ledger"
              onClick={() => onReverseRequested(event.id)}
              className={`text-xs font-bold text-amber-800 underline hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-200 ${FOCUS_RING}`}
            >
              Reverse this payment
            </button>
          ) : null}
          {canCorrect ? (
            <button
              type="button"
              data-guided-workflow-control="correct-adjustment-from-ledger"
              onClick={() => onCorrectRequested(event.id)}
              className={`text-xs font-bold text-amber-800 underline hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-200 ${FOCUS_RING}`}
            >
              Correct this adjustment
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

async function fetchFirstPage(accountId) {
  const response = await fetch(`/api/private-financing/accounts/${accountId}/events`);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Unable to load ledger history.");
  return { events: payload.events || [], pageInfo: payload.pageInfo || { hasMore: false, nextCursor: null } };
}

// Seller-facing, read-only, paginated ledger history for one account. Uses only the SF-2A events
// endpoint's own keyset cursor -- never re-derives ordering, page boundaries, or a running balance
// itself; principalRemaining*Cents on each row is the authoritative stored value the ledger-write RPC
// already verified via ledgerIntegrity.js, never recomputed here.
//
// The first page is stale-while-revalidate: previously loaded events stay on screen while a refresh
// (retry, refreshSignal from the parent) runs in the background. "Load more" is a pure append -- it
// never replaces the list -- so it stays a manual fetch that merges into the appended pages; any
// first-page refresh resets those appended pages back to the fresh first page.
export default function PrivateFinancingLedgerHistory({ accountId, product, components = [], onReverseRequested, onCorrectRequested, refreshSignal }) {
  const partyLabel = financingPartyLabel(product);
  const componentLabelsByKey = useMemo(
    () => Object.fromEntries(components.map((component) => [component.componentKey, component.label])),
    [components],
  );
  const { data, error: loadError, isLoading, isRefreshing, refresh } = useStaleWhileRevalidate(
    accountId ? `private-financing:events:${accountId}` : null,
    () => fetchFirstPage(accountId),
    { ttlMs: 30_000 },
  );
  const [appended, setAppended] = useState([]);
  const [appendedBase, setAppendedBase] = useState(null);
  const [appendedPageInfo, setAppendedPageInfo] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState("");

  // The appended pages belong to the previous first page: whenever the first
  // page changes (account switch, refresh, retry) they reset. This render-phase
  // adjustment is the React-endorsed alternative to setState inside an effect.
  if (appendedBase !== data) {
    setAppendedBase(data);
    setAppended([]);
    setAppendedPageInfo(null);
    setMoreError("");
  }

  // refreshSignal is an intentional extra dependency: any change re-triggers a fresh first page after a
  // seller action posts a new event, so the history never shows a stale reversal/correction state.
  const signaled = useRef(0);
  useEffect(() => {
    if (refreshSignal > signaled.current) {
      signaled.current = refreshSignal;
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  const firstEvents = data?.events ?? EMPTY_EVENTS;
  const events = useMemo(() => [...firstEvents, ...appended], [firstEvents, appended]);
  // The freshest pageInfo wins: the first page's until "Load more" advances it.
  const pageInfo = useMemo(
    () => appendedPageInfo ?? data?.pageInfo ?? { hasMore: false, nextCursor: null },
    [appendedPageInfo, data],
  );

  const loadMore = useCallback(() => {
    const cursor = pageInfo.nextCursor;
    if (loadingMore || !cursor) return;
    setLoadingMore(true);
    setMoreError("");
    const knownIds = new Set(events.map((event) => event.id));
    return fetch(`/api/private-financing/accounts/${accountId}/events?cursor=${encodeURIComponent(cursor)}`)
      .then((response) => response.json().then((payload) => ({ response, payload })))
      .then(({ response, payload }) => {
        if (!response.ok) throw new Error(payload.error || "Unable to load more ledger history.");
        const rows = payload.events || [];
        // The keyset cursor guarantees no duplicate/missing rows across pages -- this filter is a purely
        // defensive belt-and-suspenders check against ever rendering the same event twice.
        const newRows = rows.filter((event) => !knownIds.has(event.id));
        setAppended((current) => [...current, ...newRows]);
        setAppendedPageInfo(payload.pageInfo ?? { hasMore: false, nextCursor: null });
      })
      .catch((loadMoreError) => setMoreError(loadMoreError.message))
      .finally(() => setLoadingMore(false));
  }, [accountId, loadingMore, pageInfo, events]);
  const moreAvailable = pageInfo.nextCursor != null || pageInfo.hasMore;

  return (
    <div data-guided-workflow-ledger-history>
      <h3 className="text-lg font-black text-slate-950 dark:text-white">Ledger history</h3>

      {!data && isLoading ? <div className="mt-3"><ForgeLoadingState label="Loading ledger history…" /></div> : null}

      {!data && loadError ? (
        <div className="mt-3" data-guided-workflow-control="retry-ledger-history">
          <ForgeErrorState
            title="Unable to load ledger history."
            detail={loadError}
            onRetry={() => refresh()}
          />
        </div>
      ) : null}

      {data && events.length === 0 ? (
        <div className="mt-3">
          <ForgeEmptyState
            headline="No ledger events recorded yet."
            guidance="Events will appear here as payments, corrections, and other account activity are recorded."
          />
        </div>
      ) : null}

      {data && events.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {events.map((event) => (
            <LedgerEventRow
              key={event.id}
              event={event}
              alreadyReversed={events.some((other) => other.reversesEventId === event.id)}
              onReverseRequested={onReverseRequested}
              onCorrectRequested={onCorrectRequested}
              componentLabelsByKey={componentLabelsByKey}
              partyLabel={partyLabel}
            />
          ))}
        </ul>
      ) : null}

      {data && isRefreshing ? (
        <p role="status" className="mt-3 text-xs font-bold text-slate-400 dark:text-slate-500">Updating…</p>
      ) : null}
      {data && loadError ? (
        <p role="status" className="mt-3 text-xs font-bold text-slate-400 dark:text-slate-500">
          Could not refresh — showing the last saved ledger history.
        </p>
      ) : null}

      {data && moreAvailable ? (
        <button
          type="button"
          data-guided-workflow-control="load-more-events"
          disabled={loadingMore}
          onClick={loadMore}
          className={`mt-4 rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800 ${FOCUS_RING}`}
        >
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      ) : null}

      {moreError ? (
        <p role="alert" className="mt-2 text-sm font-bold text-red-700 dark:text-red-400">{moreError}</p>
      ) : null}
    </div>
  );
}
