// GW-2's second guided workflow: walks a landlord through preparing ONE specific vacant unit for a new
// tenant's move-in (property/unit -> tenant -> lease -> rent -> deposit -> insurance -> inspection ->
// final determination). Unlike Today's Priorities (portfolio-wide, one static step per possible
// needsAttention category), this workflow is scoped to a single unit chosen by the landlord, so its
// evaluator reads several linked tables (leases, leaseMemberships, schedules, deposits,
// insurancePolicies, insuranceRequirements, inspections) filtered down to that unit's most relevant
// lease -- see selectTargetLease below for how "most relevant" is decided.
//
// Like todaysPrioritiesWorkflow.js, live human-readable label/detail text is NOT duplicated into the
// static step definition -- it's derived from each EvaluatorResult's reasonCode via
// FIRST_TENANT_READINESS_COPY, keeping the evaluator's reasonCode the single source of truth for both
// what status a step is in and what a landlord reads about it.

import { validateWorkflowDefinition, validateEvaluatorResult, WORKFLOW_STEP_CONSEQUENCE, EVALUATOR_RESULT_STATUS } from "./guidedWorkflowContracts.js";

export const FIRST_TENANT_READINESS_STATE_EVALUATOR_ID = "first-tenant-readiness-unit-state";
export const FIRST_TENANT_READINESS_COMPLETION_EVALUATOR_ID = "first-tenant-readiness-final-determination";
export const FIRST_TENANT_READINESS_WORKFLOW_ID = "rental.first-tenant-readiness";
export const FIRST_TENANT_READINESS_WORKFLOW_VERSION = "1.0";

const FIRST_TENANT_READINESS_STEP_ORDER = Object.freeze([
  { stepId: "unit-readiness", instruction: "Confirm the unit is marked ready to show and rent." },
  { stepId: "tenant-assignment", instruction: "Assign a tenant to this unit." },
  { stepId: "lease-readiness", instruction: "Finalize and activate the lease." },
  { stepId: "recurring-rent-setup", instruction: "Set up and activate the recurring rent schedule." },
  { stepId: "security-deposit", instruction: "Collect and record the security deposit." },
  { stepId: "renters-insurance", instruction: "Verify the tenant's renter's insurance." },
  { stepId: "move-in-inspection", instruction: "Complete and finalize the move-in inspection." },
  { stepId: "ready-for-move-in", instruction: "Review the final ready-for-move-in determination." },
]);

// The existing Rental Manager surface id each step's action happens on today (RentalApplicationShell's
// buildRentalSurface id vocabulary -- the same ids RentalTodaysPrioritiesPanel already navigates to via
// needsAttention items' `destination`). null means the step is purely informational and rendered
// in-place, never navigated to (mirrors how Today's Priorities never navigates for a "nothing urgent"
// state -- there is simply nowhere to go).
export const FIRST_TENANT_READINESS_DESTINATION_BY_STEP_ID = Object.freeze({
  "unit-readiness": "setup",
  "tenant-assignment": "leases",
  "lease-readiness": "leases",
  "recurring-rent-setup": "leases",
  "security-deposit": "deposits",
  "renters-insurance": "insurance",
  "move-in-inspection": "inspections",
  "ready-for-move-in": null,
});

export function buildFirstTenantReadinessWorkflowDefinition(explanationsById = {}) {
  return validateWorkflowDefinition({
    workflowId: FIRST_TENANT_READINESS_WORKFLOW_ID,
    version: FIRST_TENANT_READINESS_WORKFLOW_VERSION,
    title: "Prepare a tenant for move-in",
    purpose: "Walk through everything a specific unit genuinely still needs before a new tenant can move in.",
    applicableRoles: ["primary_owner", "co_owner"],
    entryRoute: null,
    completionEvaluatorId: FIRST_TENANT_READINESS_COMPLETION_EVALUATOR_ID,
    steps: FIRST_TENANT_READINESS_STEP_ORDER.map(({ stepId, instruction }) => ({
      stepId,
      semanticTargetId: stepId,
      instruction,
      explanation: explanationsById[stepId] || null,
      stateEvaluatorId: FIRST_TENANT_READINESS_STATE_EVALUATOR_ID,
      consequence: WORKFLOW_STEP_CONSEQUENCE.INFORMATIONAL,
      requiresExplicitConfirmation: false,
    })),
  });
}

// The exact predicate buildRentalDashboardSummary.js uses for "vacant" -- reused verbatim (not
// re-derived) so this workflow's unit picker can never disagree with Today's Priorities' own
// "vacancies" count about which units are vacant.
export function selectVacantUnitsForReadiness(rentalData) {
  const activeLeases = (rentalData.leases || []).filter((lease) => lease.status === "active");
  const occupiedUnitIds = new Set(activeLeases.map((lease) => lease.unit_id).filter(Boolean));
  return (rentalData.units || []).filter((unit) => !occupiedUnitIds.has(unit.id));
}

// A unit can accumulate more than one lease over time (a prior tenancy, an abandoned draft). The most
// relevant one to evaluate readiness against is: an active lease if one exists, else the most recently
// created draft, else whatever is most recent overall -- never an arbitrary array-order pick.
function selectTargetLease(leases, unitId) {
  const unitLeases = (leases || []).filter((lease) => lease.unit_id === unitId);
  if (unitLeases.length === 0) return null;
  const active = unitLeases.find((lease) => lease.status === "active");
  if (active) return active;
  const byRecency = (a, b) => (b.created_at || "").localeCompare(a.created_at || "");
  const drafts = unitLeases.filter((lease) => lease.status === "draft").sort(byRecency);
  if (drafts.length > 0) return drafts[0];
  return [...unitLeases].sort(byRecency)[0];
}

function isInsuranceExpired(policy, today) {
  return Boolean(policy.expiration_date) && policy.expiration_date < today;
}

// Every field read here is documented in FIRST_TENANT_READINESS_COPY's companion reasonCodes below --
// keep the two in sync when adding a new signal.
function computeReadinessContext(rentalData, unitId, evaluatedAt) {
  const today = evaluatedAt.slice(0, 10);
  const unit = (rentalData.units || []).find((candidate) => candidate.id === unitId) || null;
  const lease = selectTargetLease(rentalData.leases || [], unitId);
  const hasTenantAssigned = lease
    ? (rentalData.leaseMemberships || []).some((membership) => membership.lease_id === lease.id)
    : false;
  const schedule = lease ? (rentalData.schedules || []).find((candidate) => candidate.lease_id === lease.id) || null : null;
  const deposit = lease ? (rentalData.deposits || []).find((candidate) => candidate.lease_id === lease.id) || null : null;
  const insuranceRequirement = lease
    ? (rentalData.insuranceRequirements || []).find((candidate) => candidate.lease_id === lease.id) || null
    : null;
  const insurancePolicies = lease ? (rentalData.insurancePolicies || []).filter((candidate) => candidate.lease_id === lease.id) : [];
  const verifiedPolicy = insurancePolicies.find((policy) => policy.status === "verified") || null;
  const pendingPolicy = insurancePolicies.find((policy) => policy.status === "pending_verification") || null;
  const moveInInspection = lease
    ? (rentalData.inspections || []).find((candidate) => candidate.lease_id === lease.id && candidate.inspection_type === "move_in") || null
    : null;
  return { unit, lease, hasTenantAssigned, schedule, deposit, insuranceRequirement, verifiedPolicy, pendingPolicy, moveInInspection, today };
}

function evaluateUnitReadiness(context) {
  if (!context.unit) return { status: EVALUATOR_RESULT_STATUS.BLOCKED, reasonCode: "unit_not_found" };
  if (context.unit.status === "available" || context.unit.status === "occupied") {
    return { status: EVALUATOR_RESULT_STATUS.COMPLETE, reasonCode: "unit_ready" };
  }
  if (context.unit.status === "preparing") return { status: EVALUATOR_RESULT_STATUS.REQUIRED, reasonCode: "unit_marked_preparing" };
  if (context.unit.status === "inactive") return { status: EVALUATOR_RESULT_STATUS.BLOCKED, reasonCode: "unit_marked_inactive" };
  return { status: EVALUATOR_RESULT_STATUS.REQUIRED, reasonCode: "unit_status_unrecognized" };
}

function evaluateTenantAssignment(context) {
  return context.hasTenantAssigned
    ? { status: EVALUATOR_RESULT_STATUS.COMPLETE, reasonCode: "tenant_assigned" }
    : { status: EVALUATOR_RESULT_STATUS.REQUIRED, reasonCode: "no_tenant_assigned" };
}

function evaluateLeaseReadiness(context) {
  if (!context.lease) return { status: EVALUATOR_RESULT_STATUS.BLOCKED, reasonCode: "no_lease_to_activate" };
  if (context.lease.status === "active") return { status: EVALUATOR_RESULT_STATUS.COMPLETE, reasonCode: "lease_active" };
  if (context.lease.status === "draft") return { status: EVALUATOR_RESULT_STATUS.REQUIRED, reasonCode: "lease_still_draft" };
  return { status: EVALUATOR_RESULT_STATUS.BLOCKED, reasonCode: "lease_not_active_status" };
}

function evaluateRecurringRentSetup(context) {
  if (!context.lease || context.lease.status !== "active") {
    return { status: EVALUATOR_RESULT_STATUS.BLOCKED, reasonCode: "lease_not_active_for_schedule" };
  }
  if (!context.schedule) return { status: EVALUATOR_RESULT_STATUS.REQUIRED, reasonCode: "no_schedule_created" };
  return context.schedule.status === "active"
    ? { status: EVALUATOR_RESULT_STATUS.COMPLETE, reasonCode: "schedule_active" }
    : { status: EVALUATOR_RESULT_STATUS.REQUIRED, reasonCode: "schedule_not_activated" };
}

function evaluateSecurityDeposit(context) {
  if (!context.lease) return { status: EVALUATOR_RESULT_STATUS.BLOCKED, reasonCode: "no_lease_for_deposit" };
  if (!context.deposit) return { status: EVALUATOR_RESULT_STATUS.REQUIRED, reasonCode: "no_deposit_recorded" };
  return context.deposit.status === "held"
    ? { status: EVALUATOR_RESULT_STATUS.COMPLETE, reasonCode: "deposit_held" }
    : { status: EVALUATOR_RESULT_STATUS.REQUIRED, reasonCode: "deposit_not_fully_collected" };
}

function evaluateRentersInsurance(context) {
  if (!context.lease) return { status: EVALUATOR_RESULT_STATUS.BLOCKED, reasonCode: "no_lease_for_insurance" };
  // required === false is an explicit landlord opt-out; absence of a requirement row at all matches
  // buildRentalDashboardSummary.js's own implicit-required default for existing active leases.
  if (context.insuranceRequirement && context.insuranceRequirement.required === false) {
    return { status: EVALUATOR_RESULT_STATUS.NOT_APPLICABLE, reasonCode: "insurance_not_required" };
  }
  if (context.verifiedPolicy) {
    return isInsuranceExpired(context.verifiedPolicy, context.today)
      ? { status: EVALUATOR_RESULT_STATUS.REQUIRED, reasonCode: "insurance_expired" }
      : { status: EVALUATOR_RESULT_STATUS.COMPLETE, reasonCode: "insurance_verified" };
  }
  if (context.pendingPolicy) return { status: EVALUATOR_RESULT_STATUS.REQUIRED, reasonCode: "insurance_pending_verification" };
  return { status: EVALUATOR_RESULT_STATUS.REQUIRED, reasonCode: "insurance_not_verified" };
}

function evaluateMoveInInspection(context) {
  if (!context.lease) return { status: EVALUATOR_RESULT_STATUS.BLOCKED, reasonCode: "no_lease_for_inspection" };
  if (!context.moveInInspection) return { status: EVALUATOR_RESULT_STATUS.REQUIRED, reasonCode: "no_move_in_inspection" };
  return context.moveInInspection.status !== "draft"
    ? { status: EVALUATOR_RESULT_STATUS.COMPLETE, reasonCode: "inspection_finalized" }
    : { status: EVALUATOR_RESULT_STATUS.REQUIRED, reasonCode: "inspection_not_finalized" };
}

// Always REQUIRED when reached -- by construction (the session controller stops the walk at the first
// step needing attention, in order) this step is only ever reached once every step before it has
// resolved to COMPLETE, NOT_APPLICABLE, or UNAVAILABLE. It is deliberately never itself the thing that
// decides "ready for move-in" -- the panel's own message is gated by whether the session actually
// reached this step versus stopped earlier, using the same sessionHasUnavailableSteps safety net
// Today's Priorities uses, so "ready" can never be claimed while a step's real state is unknown.
function evaluateReadyForMoveIn() {
  return { status: EVALUATOR_RESULT_STATUS.REQUIRED, reasonCode: "final_review" };
}

const STEP_EVALUATORS = Object.freeze({
  "unit-readiness": evaluateUnitReadiness,
  "tenant-assignment": evaluateTenantAssignment,
  "lease-readiness": evaluateLeaseReadiness,
  "recurring-rent-setup": evaluateRecurringRentSetup,
  "security-deposit": evaluateSecurityDeposit,
  "renters-insurance": evaluateRentersInsurance,
  "move-in-inspection": evaluateMoveInInspection,
  "ready-for-move-in": evaluateReadyForMoveIn,
});

export function buildFirstTenantReadinessEvaluatorResults(workflowDefinition, rentalData, unitId, evaluatedAt) {
  const context = computeReadinessContext(rentalData, unitId, evaluatedAt);
  return workflowDefinition.steps.map((step) => {
    const { status, reasonCode } = STEP_EVALUATORS[step.stepId](context);
    return validateEvaluatorResult({ stepId: step.stepId, status, reasonCode, evaluatedAt });
  });
}

// Human-readable copy keyed by [stepId][reasonCode] -- the reasonCode above is the single source of
// truth for which entry applies, so status and displayed text can never drift apart. Only entries for
// non-passing statuses (REQUIRED/BLOCKED) need copy -- COMPLETE/NOT_APPLICABLE steps are skipped over
// and never rendered as the current step.
export const FIRST_TENANT_READINESS_COPY = Object.freeze({
  "unit-readiness": {
    unit_not_found: { label: "Unit not found", detail: "This unit could not be located in your portfolio." },
    unit_marked_preparing: { label: "Unit not marked ready", detail: "This unit is still marked \"preparing.\" Mark it ready to show and rent." },
    unit_marked_inactive: { label: "Unit marked inactive", detail: "This unit is marked inactive, so it can't be prepared for a new tenant until you reactivate it." },
    unit_status_unrecognized: { label: "Unit status needs review", detail: "This unit's status couldn't be recognized. Review it in property and unit setup." },
  },
  "tenant-assignment": {
    no_tenant_assigned: { label: "No tenant assigned yet", detail: "Assign a tenant to this unit by starting a lease." },
  },
  "lease-readiness": {
    no_lease_to_activate: { label: "Waiting on tenant assignment", detail: "A lease can't be activated until a tenant is assigned to this unit." },
    lease_still_draft: { label: "Lease not yet active", detail: "Finish and activate this unit's lease." },
    lease_not_active_status: { label: "Lease isn't active", detail: "This unit's most recent lease isn't active. Review it before continuing." },
  },
  "recurring-rent-setup": {
    lease_not_active_for_schedule: { label: "Waiting on an active lease", detail: "Rent can't be scheduled until this unit's lease is active." },
    no_schedule_created: { label: "No rent schedule yet", detail: "Set up the recurring rent schedule for this lease." },
    schedule_not_activated: { label: "Rent schedule not activated", detail: "Activate the recurring rent schedule for this lease." },
  },
  "security-deposit": {
    no_lease_for_deposit: { label: "Waiting on a lease", detail: "A security deposit can't be recorded until this unit has a lease." },
    no_deposit_recorded: { label: "No security deposit recorded", detail: "Record the security deposit for this lease." },
    deposit_not_fully_collected: { label: "Security deposit not fully collected", detail: "This lease's security deposit hasn't been fully collected yet." },
  },
  "renters-insurance": {
    no_lease_for_insurance: { label: "Waiting on a lease", detail: "Renter's insurance can't be verified until this unit has a lease." },
    insurance_not_verified: { label: "Renter's insurance not verified", detail: "Verify the tenant's renter's insurance for this lease." },
    insurance_pending_verification: { label: "Renter's insurance pending", detail: "The tenant's renter's insurance is awaiting your verification." },
    insurance_expired: { label: "Renter's insurance expired", detail: "The tenant's renter's insurance has expired and needs to be renewed and re-verified." },
  },
  "move-in-inspection": {
    no_lease_for_inspection: { label: "Waiting on a lease", detail: "A move-in inspection can't be recorded until this unit has a lease." },
    no_move_in_inspection: { label: "No move-in inspection yet", detail: "Complete a move-in inspection for this lease." },
    inspection_not_finalized: { label: "Move-in inspection not finalized", detail: "Finalize the move-in inspection for this lease." },
  },
  "ready-for-move-in": {
    final_review: { label: "Final review", detail: "Every required step for this unit has been completed." },
  },
});
