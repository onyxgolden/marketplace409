// Shared by every /api/private-financing/** read model that needs an account's current balance --
// factored out so the list endpoint and the detail endpoint compute it exactly the same way, through the
// exact same replayEvents.js/persistedRowMapping.js path SF-1 already proved correct. Never a stored
// figure, never computed twice in two slightly different ways.

import { mapEventRowsForReplay } from "./persistedRowMapping.js";
import { replayEvents } from "./replayEvents.js";

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

// Returns null when there are no events yet (an account row that somehow exists with no account_opened
// event -- should not happen given open_private_financing_account's own atomicity, but this read model
// never assumes it and never calls replayEvents on an empty history).
export function computeAccountBalanceSummary(eventRows, componentRows, termsRows, { asOfDate } = {}) {
  if (!eventRows || eventRows.length === 0) return null;
  const resolvedAsOfDate = asOfDate || todayISODate();
  const { events, componentVersions, accountTermsVersions } = mapEventRowsForReplay(eventRows, componentRows, termsRows);
  const state = replayEvents({ events, componentVersions, accountTermsVersions, asOfDate: resolvedAsOfDate });
  return {
    asOfDate: resolvedAsOfDate,
    // Every component's remaining principal, keyed by componentKey -- V1 Terms Generalization: no longer
    // two fixed named fields. A caller that wants "the interest-bearing figure" must look up the specific
    // component it means by its own componentKey, not assume one exists.
    remainingPrincipalByComponentCents: state.remainingPrincipalByComponentCents,
    totalPrincipalRemainingCents: state.totalPrincipalRemainingCents,
    cumulativeInterestPaidCents: state.cumulativeInterestPaidCents,
    cumulativeCashPrincipalPaidCents: state.cumulativeCashPrincipalPaidCents,
    // Cumulative principal forgiven via principal_correction/interest_correction/payoff_concession
    // events with a discretionary or contractual basis -- "seller credits/concessions to date." Real,
    // replayed, never a client-side guess.
    cumulativePrincipalForgivenCents: state.cumulativePrincipalForgivenCents,
    // Accrued interest not yet paid, as of asOfDate, per component and in total.
    unpaidAccruedInterestByComponentCents: state.unpaidAccruedInterestByComponentCents,
    unpaidAccruedInterestCents: state.unpaidAccruedInterestCents,
    // The CONTRACTUAL regular payment amount from the account's own terms -- e.g. "the payment is
    // $517.85." This is deliberately NOT named/labeled "current amount due," "amount owed," or anything
    // implying a calculated present obligation: until the due-state engine (dueState.js) is wired in as
    // the authoritative source for a given account, "current amount due"/"past-due amount"/"next due
    // date" must be shown separately as "Not tracked yet." A caller must never rename this field to imply
    // arrears-awareness.
    regularScheduledPaymentCents: Object.values(state.components).reduce((sum, component) => sum + component.scheduledComponentAmountCents, 0),
    components: state.components,
    closed: state.closed,
    closureReason: state.closureReason,
  };
}
