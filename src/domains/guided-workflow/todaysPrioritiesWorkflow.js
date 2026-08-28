// GW-1's one non-mutating prototype workflow, per FORGE_BRAIN_AUTONOMOUS_REPAIR_DESIGN.md Section 12's own
// suggested default: "Review what requires attention today." Rather than inventing new business logic, this
// wraps the existing, real `buildRentalDashboardSummary().needsAttention` queue (already computed, already
// read-only, already rendered on the Overview panel) in the versioned guided-workflow contracts.
//
// The workflow definition is intentionally STATIC and versioned (one step per possible needsAttention item
// id, in the fixed severity order buildRentalDashboardSummary.js itself uses) -- what's dynamic per session
// is which of those steps are actually REQUIRED right now, decided entirely by whether that id is present in
// a freshly computed needsAttention array. This keeps the definition reviewable (it can't silently invent or
// reorder items) while completion/applicability stays fully state-driven, matching the design doc's "Skip
// steps already completed or not applicable" and "never invent... completion" requirements.
//
// A step's live label/detail/destination/severity intentionally is NOT duplicated into this static
// definition -- it already lives on the matching buildRentalDashboardSummary() needsAttention entry, and
// callers should read it from there so the two can never drift out of sync.

import { validateWorkflowDefinition, validateEvaluatorResult, WORKFLOW_STEP_CONSEQUENCE, EVALUATOR_RESULT_STATUS } from "./guidedWorkflowContracts.js";

export const TODAYS_PRIORITIES_STATE_EVALUATOR_ID = "todays-priorities-attention-item";
export const TODAYS_PRIORITIES_COMPLETION_EVALUATOR_ID = "todays-priorities-nothing-required";

// Fixed severity order from buildRentalDashboardSummary.js's own push sequence (critical, then warning,
// then info) -- these ids are the complete, real vocabulary that function can ever emit.
const TODAYS_PRIORITIES_STEP_ORDER = Object.freeze([
  { stepId: "overdue-forge", instruction: "Review FORGE-collectible rent that's overdue." },
  { stepId: "urgent-maintenance", instruction: "Respond to urgent or high-priority maintenance requests." },
  { stepId: "externally-managed", instruction: "Reconcile balances still authoritative in Rentec." },
  { stepId: "leases-expiring-soon", instruction: "Plan renewals or move-outs for leases expiring within 30 days." },
  { stepId: "vacancies", instruction: "Review vacant units without an active lease." },
  { stepId: "readiness-gaps", instruction: "Close readiness gaps across insurance, deposits, and move-in inspections." },
  { stepId: "routine-maintenance", instruction: "Review routine maintenance requests in progress." },
  { stepId: "awaiting-settlement", instruction: "Review succeeded payments not yet settled." },
  { stepId: "support-cases", instruction: "Review open support cases." },
]);

export const TODAYS_PRIORITIES_WORKFLOW_ID = "rental.todays-priorities";
export const TODAYS_PRIORITIES_WORKFLOW_VERSION = "1.0";

export function buildTodaysPrioritiesWorkflowDefinition(explanationsById = {}) {
  return validateWorkflowDefinition({
    workflowId: TODAYS_PRIORITIES_WORKFLOW_ID,
    version: TODAYS_PRIORITIES_WORKFLOW_VERSION,
    title: "Today's priorities",
    purpose: "Walk through what currently needs attention across the rental portfolio, one item at a time.",
    applicableRoles: ["primary_owner", "co_owner"],
    entryRoute: null,
    completionEvaluatorId: TODAYS_PRIORITIES_COMPLETION_EVALUATOR_ID,
    steps: TODAYS_PRIORITIES_STEP_ORDER.map(({ stepId, instruction }) => ({
      stepId,
      semanticTargetId: stepId,
      instruction,
      explanation: explanationsById[stepId] || null,
      stateEvaluatorId: TODAYS_PRIORITIES_STATE_EVALUATOR_ID,
      consequence: WORKFLOW_STEP_CONSEQUENCE.INFORMATIONAL,
      requiresExplicitConfirmation: false,
    })),
  });
}

// The only authoritative source of "is this step required right now": presence in a freshly computed
// needsAttention array. A step is never marked required, complete, or skipped by a client-side click --
// see FORGE_BRAIN_AUTONOMOUS_REPAIR_DESIGN.md Section 14's "A click without authoritative state change
// does not complete a step."
export function evaluateTodaysPrioritiesStep(step, needsAttentionIds, evaluatedAt) {
  const status = needsAttentionIds.has(step.stepId)
    ? EVALUATOR_RESULT_STATUS.REQUIRED
    : EVALUATOR_RESULT_STATUS.NOT_APPLICABLE;
  return validateEvaluatorResult({
    stepId: step.stepId,
    status,
    reasonCode: status === EVALUATOR_RESULT_STATUS.REQUIRED ? "present_in_needs_attention" : "absent_from_needs_attention",
    evaluatedAt,
  });
}

export function buildTodaysPrioritiesEvaluatorResults(workflowDefinition, needsAttention, evaluatedAt) {
  const needsAttentionIds = new Set(needsAttention.map((item) => item.id));
  return workflowDefinition.steps.map((step) => evaluateTodaysPrioritiesStep(step, needsAttentionIds, evaluatedAt));
}
