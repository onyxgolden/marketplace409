// GW-3's first "user-selected operational workflow": walks a landlord through renewing ONE specific
// lease that's expiring within 30 days, using the existing draft-then-approve lease change flow
// (RentalLeaseLifecyclePanel.jsx / rental_lease_changes / apply_rental_lease_change()). Renewal is the
// only supported intent today -- there is no "plan a move-out instead" path anywhere in the schema or
// API, so this workflow does not attempt to branch toward one.
//
// Like firstTenantReadinessWorkflow.js, live human-readable label/detail text is derived from each
// EvaluatorResult's reasonCode via LEASE_RENEWAL_COPY, not duplicated into the static step definition.

import { validateWorkflowDefinition, validateEvaluatorResult, WORKFLOW_STEP_CONSEQUENCE, EVALUATOR_RESULT_STATUS } from "./guidedWorkflowContracts.js";

export const LEASE_RENEWAL_STATE_EVALUATOR_ID = "lease-renewal-state";
export const LEASE_RENEWAL_COMPLETION_EVALUATOR_ID = "lease-renewal-final-determination";
export const LEASE_RENEWAL_WORKFLOW_ID = "rental.lease-renewal";
export const LEASE_RENEWAL_WORKFLOW_VERSION = "1.0";

const LEASE_RENEWAL_STEP_ORDER = Object.freeze([
  { stepId: "renewal-draft", instruction: "Draft the lease renewal terms." },
  { stepId: "renewal-approval", instruction: "Approve and apply the renewal." },
  { stepId: "renewal-review", instruction: "Review the completed renewal." },
]);

// Both actionable steps live on the same existing surface (RentalApplicationShell's "lease-lifecycle"
// id) -- drafting and approving/applying a renewal both happen inside RentalLeaseLifecyclePanel. The
// final review step is purely informational and rendered in-place, never navigated to.
export const LEASE_RENEWAL_DESTINATION_BY_STEP_ID = Object.freeze({
  "renewal-draft": "lease-lifecycle",
  "renewal-approval": "lease-lifecycle",
  "renewal-review": null,
});

export function buildLeaseRenewalWorkflowDefinition(explanationsById = {}) {
  return validateWorkflowDefinition({
    workflowId: LEASE_RENEWAL_WORKFLOW_ID,
    version: LEASE_RENEWAL_WORKFLOW_VERSION,
    title: "Renew an expiring lease",
    purpose: "Walk through renewing a lease that's expiring within 30 days, using the existing draft-then-approve lease change flow.",
    applicableRoles: ["primary_owner", "co_owner"],
    entryRoute: null,
    completionEvaluatorId: LEASE_RENEWAL_COMPLETION_EVALUATOR_ID,
    steps: LEASE_RENEWAL_STEP_ORDER.map(({ stepId, instruction }) => ({
      stepId,
      semanticTargetId: stepId,
      instruction,
      explanation: explanationsById[stepId] || null,
      stateEvaluatorId: LEASE_RENEWAL_STATE_EVALUATOR_ID,
      consequence: WORKFLOW_STEP_CONSEQUENCE.INFORMATIONAL,
      requiresExplicitConfirmation: false,
    })),
  });
}

function daysBetween(date, today) {
  return Math.ceil((Date.parse(date) - Date.parse(today)) / 86_400_000);
}

// The exact predicate buildRentalDashboardSummary.js uses for its "leases-expiring-soon" needsAttention
// item -- reused verbatim (not re-derived, not a new threshold) so this workflow's lease picker can
// never disagree with Today's Priorities' own count about which leases actually qualify. Unlike
// selectVacantUnitsForReadiness (time-independent), this predicate is date-dependent, so callers must
// pass `today` explicitly.
export function selectLeasesExpiringSoonForRenewal(rentalData, today) {
  return (rentalData.leases || [])
    .filter((lease) => lease.status === "active" && lease.end_date
      && daysBetween(lease.end_date, today) >= 0 && daysBetween(lease.end_date, today) <= 30)
    .sort((a, b) => Date.parse(a.end_date) - Date.parse(b.end_date));
}

// A lease can accumulate multiple rental_lease_changes rows over its lifetime -- no uniqueness
// constraint exists. Filtering to change_type === "renewal" is required for correctness: an unrelated
// in-progress amendment or proration draft on the same lease must never be mistaken for "the renewal."
// Excluding void rows means an abandoned draft doesn't make renewal-draft look falsely COMPLETE.
// Sorting by recency (rather than GW-2's "prefer active, else most recent draft" two-tier lookup) is
// required because a lease can have several *applied* renewals across successive years -- the newest
// one is always the one relevant to the landlord's current situation.
function selectTargetRenewalChange(leaseChanges, leaseId) {
  const relevant = (leaseChanges || [])
    .filter((change) => change.lease_id === leaseId && change.change_type === "renewal" && change.status !== "void")
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  return relevant.length > 0 ? relevant[0] : null;
}

function computeRenewalContext(rentalData, leaseId) {
  const lease = (rentalData.leases || []).find((candidate) => candidate.id === leaseId) || null;
  const renewalChange = selectTargetRenewalChange(rentalData.leaseChanges || [], leaseId);
  return { lease, renewalChange };
}

function evaluateRenewalDraft(context) {
  if (!context.lease) return { status: EVALUATOR_RESULT_STATUS.BLOCKED, reasonCode: "lease_not_found" };
  return context.renewalChange
    ? { status: EVALUATOR_RESULT_STATUS.COMPLETE, reasonCode: "renewal_drafted" }
    : { status: EVALUATOR_RESULT_STATUS.REQUIRED, reasonCode: "no_renewal_drafted_yet" };
}

function evaluateRenewalApproval(context) {
  if (!context.lease) return { status: EVALUATOR_RESULT_STATUS.BLOCKED, reasonCode: "lease_not_found" };
  if (!context.renewalChange) return { status: EVALUATOR_RESULT_STATUS.BLOCKED, reasonCode: "renewal_not_drafted_yet" };
  if (context.renewalChange.status === "applied") return { status: EVALUATOR_RESULT_STATUS.COMPLETE, reasonCode: "renewal_applied" };
  // approve-lease-change flips draft->approved and calls the apply RPC in one request; if the RPC
  // throws after the update commits, a row can be durably stuck at "approved" with no existing UI
  // retry path (RentalLeaseLifecyclePanel only shows its approve button for status==="draft" rows).
  // BLOCKED here is honest -- the workflow must never imply a fix is available that the destination
  // panel doesn't actually offer.
  if (context.renewalChange.status === "approved") return { status: EVALUATOR_RESULT_STATUS.BLOCKED, reasonCode: "renewal_approved_but_not_applied" };
  return { status: EVALUATOR_RESULT_STATUS.REQUIRED, reasonCode: "renewal_pending_approval" };
}

// Always REQUIRED when reached -- by construction (the session controller stops the walk at the first
// step needing attention, in order) this step is only ever reached once renewal-draft and
// renewal-approval have both resolved to COMPLETE. Mirrors firstTenantReadinessWorkflow.js's
// evaluateReadyForMoveIn exactly.
function evaluateRenewalReview() {
  return { status: EVALUATOR_RESULT_STATUS.REQUIRED, reasonCode: "final_review" };
}

const STEP_EVALUATORS = Object.freeze({
  "renewal-draft": evaluateRenewalDraft,
  "renewal-approval": evaluateRenewalApproval,
  "renewal-review": evaluateRenewalReview,
});

export function buildLeaseRenewalEvaluatorResults(workflowDefinition, rentalData, leaseId, evaluatedAt) {
  const context = computeRenewalContext(rentalData, leaseId);
  return workflowDefinition.steps.map((step) => {
    const { status, reasonCode } = STEP_EVALUATORS[step.stepId](context);
    return validateEvaluatorResult({ stepId: step.stepId, status, reasonCode, evaluatedAt });
  });
}

// Human-readable copy keyed by [stepId][reasonCode] -- the reasonCode above is the single source of
// truth for which entry applies. Only entries for non-passing statuses (REQUIRED/BLOCKED) are needed --
// COMPLETE steps are skipped over and never rendered as the current step.
export const LEASE_RENEWAL_COPY = Object.freeze({
  "renewal-draft": {
    lease_not_found: { label: "Lease not found", detail: "This lease could not be located in your portfolio." },
    no_renewal_drafted_yet: { label: "No renewal drafted yet", detail: "Save a draft renewal for this lease with its new terms." },
  },
  "renewal-approval": {
    lease_not_found: { label: "Lease not found", detail: "This lease could not be located in your portfolio." },
    renewal_not_drafted_yet: { label: "Waiting on a draft renewal", detail: "A renewal can't be approved until its draft terms are saved." },
    renewal_pending_approval: { label: "Renewal awaiting approval", detail: "Approve and apply this lease's draft renewal terms." },
    renewal_approved_but_not_applied: { label: "Renewal approved but not applied", detail: "This renewal was approved but couldn't be fully applied. Contact support to resolve it before continuing." },
  },
  "renewal-review": {
    final_review: { label: "Final review", detail: "This lease's renewal has been approved and applied." },
  },
});
