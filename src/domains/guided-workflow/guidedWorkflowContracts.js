// Versioned, runtime-validated contracts for the Guided Workflow Engine (FORGE_BRAIN_AUTONOMOUS_REPAIR_DESIGN.md
// Section 12). These mirror that document's GuidedWorkflowDefinition/GuidedWorkflowStep/GuidedWorkflowSession
// TypeScript shapes, plus two contracts the shapes imply but don't name: an evaluator result and a semantic
// target. Validation fails closed -- an unknown or malformed shape is rejected here, not passed through and
// discovered later as a runtime crash in the session controller or the UI.

export const GUIDED_WORKFLOW_SCHEMA_VERSION = "1.0";

export class MalformedGuidedWorkflowContractError extends Error {
  constructor(contractName, reason) {
    super(`Malformed ${contractName}: ${reason}`);
    this.name = "MalformedGuidedWorkflowContractError";
    this.contractName = contractName;
    this.reason = reason;
  }
}

export const WORKFLOW_STEP_CONSEQUENCE = Object.freeze({
  INFORMATIONAL: "informational",
  REVERSIBLE: "reversible",
  CONSEQUENTIAL: "consequential",
});

export const EVALUATOR_RESULT_STATUS = Object.freeze({
  REQUIRED: "required",
  AVAILABLE: "available",
  COMPLETE: "complete",
  BLOCKED: "blocked",
  NOT_APPLICABLE: "not_applicable",
  REQUIRES_CONFIRMATION: "requires_confirmation",
  // Distinct from NOT_APPLICABLE: the evaluator genuinely doesn't know whether this step is
  // required, because the data source it depends on failed to load -- never means "checked and
  // fine." A caller must never treat UNAVAILABLE as a green signal (see the guided-workflow session
  // controller's completion messaging, which must not claim "nothing urgent" while any step is
  // unavailable).
  UNAVAILABLE: "unavailable",
});

export const GUIDED_WORKFLOW_SESSION_STATUS = Object.freeze({
  ACTIVE: "active",
  PAUSED: "paused",
  BLOCKED: "blocked",
  COMPLETED: "completed",
  EXITED: "exited",
});

function fail(contractName, reason) {
  throw new MalformedGuidedWorkflowContractError(contractName, reason);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateSemanticTarget(target) {
  if (!isPlainObject(target)) fail("SemanticTarget", "must be an object");
  if (!isNonEmptyString(target.targetId)) fail("SemanticTarget", "targetId must be a non-empty string");
  if (!isNonEmptyString(target.description)) fail("SemanticTarget", "description must be a non-empty string");
  return Object.freeze({ targetId: target.targetId, description: target.description });
}

export function validateWorkflowStep(step) {
  if (!isPlainObject(step)) fail("GuidedWorkflowStep", "must be an object");
  if (!isNonEmptyString(step.stepId)) fail("GuidedWorkflowStep", "stepId must be a non-empty string");
  if (!isNonEmptyString(step.semanticTargetId)) fail("GuidedWorkflowStep", "semanticTargetId must be a non-empty string");
  if (!isNonEmptyString(step.instruction)) fail("GuidedWorkflowStep", "instruction must be a non-empty string");
  if (step.explanation !== undefined && step.explanation !== null && typeof step.explanation !== "string") {
    fail("GuidedWorkflowStep", "explanation must be a string or null when present");
  }
  if (!isNonEmptyString(step.stateEvaluatorId)) fail("GuidedWorkflowStep", "stateEvaluatorId must be a non-empty string");
  if (step.skipWhen !== undefined && !Array.isArray(step.skipWhen)) {
    fail("GuidedWorkflowStep", "skipWhen must be an array when present");
  }
  if (!Object.values(WORKFLOW_STEP_CONSEQUENCE).includes(step.consequence)) {
    fail("GuidedWorkflowStep", `consequence must be one of ${Object.values(WORKFLOW_STEP_CONSEQUENCE).join(", ")}`);
  }
  if (typeof step.requiresExplicitConfirmation !== "boolean") {
    fail("GuidedWorkflowStep", "requiresExplicitConfirmation must be a boolean");
  }
  // A consequential step that doesn't require explicit confirmation would let the session
  // advance past a real mutation without the landlord ever confirming it -- the design doc's
  // consequential-action boundary (Section 12) makes confirmation mandatory for that class of
  // step, so this is enforced at the contract level, not left to each workflow author to remember.
  if (step.consequence === WORKFLOW_STEP_CONSEQUENCE.CONSEQUENTIAL && step.requiresExplicitConfirmation !== true) {
    fail("GuidedWorkflowStep", "a consequential step must set requiresExplicitConfirmation to true");
  }
  return Object.freeze({
    stepId: step.stepId,
    semanticTargetId: step.semanticTargetId,
    instruction: step.instruction,
    explanation: step.explanation ?? null,
    stateEvaluatorId: step.stateEvaluatorId,
    skipWhen: Object.freeze([...(step.skipWhen || [])]),
    consequence: step.consequence,
    requiresExplicitConfirmation: step.requiresExplicitConfirmation,
  });
}

export function validateWorkflowDefinition(definition) {
  if (!isPlainObject(definition)) fail("GuidedWorkflowDefinition", "must be an object");
  if (!isNonEmptyString(definition.workflowId)) fail("GuidedWorkflowDefinition", "workflowId must be a non-empty string");
  if (!isNonEmptyString(definition.version)) fail("GuidedWorkflowDefinition", "version must be a non-empty string");
  if (!isNonEmptyString(definition.title)) fail("GuidedWorkflowDefinition", "title must be a non-empty string");
  if (!isNonEmptyString(definition.purpose)) fail("GuidedWorkflowDefinition", "purpose must be a non-empty string");
  if (!Array.isArray(definition.applicableRoles) || definition.applicableRoles.length === 0) {
    fail("GuidedWorkflowDefinition", "applicableRoles must be a non-empty array");
  }
  if (definition.entryRoute !== undefined && definition.entryRoute !== null && typeof definition.entryRoute !== "string") {
    fail("GuidedWorkflowDefinition", "entryRoute must be a string or null when present");
  }
  if (!Array.isArray(definition.steps) || definition.steps.length === 0) {
    fail("GuidedWorkflowDefinition", "steps must be a non-empty array");
  }
  const validatedSteps = definition.steps.map(validateWorkflowStep);
  const stepIds = new Set();
  for (const step of validatedSteps) {
    if (stepIds.has(step.stepId)) fail("GuidedWorkflowDefinition", `duplicate stepId "${step.stepId}"`);
    stepIds.add(step.stepId);
  }
  if (!isNonEmptyString(definition.completionEvaluatorId)) {
    fail("GuidedWorkflowDefinition", "completionEvaluatorId must be a non-empty string");
  }
  return Object.freeze({
    workflowId: definition.workflowId,
    version: definition.version,
    title: definition.title,
    purpose: definition.purpose,
    applicableRoles: Object.freeze([...definition.applicableRoles]),
    entryRoute: definition.entryRoute ?? null,
    steps: Object.freeze(validatedSteps),
    completionEvaluatorId: definition.completionEvaluatorId,
  });
}

export function validateEvaluatorResult(result) {
  if (!isPlainObject(result)) fail("EvaluatorResult", "must be an object");
  if (!isNonEmptyString(result.stepId)) fail("EvaluatorResult", "stepId must be a non-empty string");
  if (!Object.values(EVALUATOR_RESULT_STATUS).includes(result.status)) {
    fail("EvaluatorResult", `status must be one of ${Object.values(EVALUATOR_RESULT_STATUS).join(", ")}`);
  }
  if (result.reasonCode !== undefined && typeof result.reasonCode !== "string") {
    fail("EvaluatorResult", "reasonCode must be a string when present");
  }
  if (!isNonEmptyString(result.evaluatedAt)) fail("EvaluatorResult", "evaluatedAt must be a non-empty string");
  return Object.freeze({
    stepId: result.stepId,
    status: result.status,
    reasonCode: result.reasonCode ?? null,
    evaluatedAt: result.evaluatedAt,
  });
}

export function validateGuidedWorkflowSession(session) {
  if (!isPlainObject(session)) fail("GuidedWorkflowSession", "must be an object");
  if (!isNonEmptyString(session.sessionId)) fail("GuidedWorkflowSession", "sessionId must be a non-empty string");
  if (!isNonEmptyString(session.workflowId)) fail("GuidedWorkflowSession", "workflowId must be a non-empty string");
  if (!isNonEmptyString(session.workflowVersion)) fail("GuidedWorkflowSession", "workflowVersion must be a non-empty string");
  if (!isNonEmptyString(session.actingUserId)) fail("GuidedWorkflowSession", "actingUserId must be a non-empty string");
  if (!isNonEmptyString(session.canonicalOwnerId)) fail("GuidedWorkflowSession", "canonicalOwnerId must be a non-empty string");
  if (session.currentStepId !== null && !isNonEmptyString(session.currentStepId)) {
    fail("GuidedWorkflowSession", "currentStepId must be a non-empty string or null");
  }
  if (!Array.isArray(session.completedStepIds)) fail("GuidedWorkflowSession", "completedStepIds must be an array");
  if (!Array.isArray(session.skippedSteps)) fail("GuidedWorkflowSession", "skippedSteps must be an array");
  for (const skipped of session.skippedSteps) {
    if (!isPlainObject(skipped) || !isNonEmptyString(skipped.stepId) || !isNonEmptyString(skipped.reasonCode)) {
      fail("GuidedWorkflowSession", "each skippedSteps entry must be { stepId, reasonCode }");
    }
  }
  if (!Object.values(GUIDED_WORKFLOW_SESSION_STATUS).includes(session.status)) {
    fail("GuidedWorkflowSession", `status must be one of ${Object.values(GUIDED_WORKFLOW_SESSION_STATUS).join(", ")}`);
  }
  if (!isNonEmptyString(session.startedAt)) fail("GuidedWorkflowSession", "startedAt must be a non-empty string");
  if (!isNonEmptyString(session.updatedAt)) fail("GuidedWorkflowSession", "updatedAt must be a non-empty string");
  return Object.freeze({
    sessionId: session.sessionId,
    workflowId: session.workflowId,
    workflowVersion: session.workflowVersion,
    actingUserId: session.actingUserId,
    canonicalOwnerId: session.canonicalOwnerId,
    currentStepId: session.currentStepId,
    completedStepIds: Object.freeze([...session.completedStepIds]),
    skippedSteps: Object.freeze(session.skippedSteps.map((s) => Object.freeze({ ...s }))),
    status: session.status,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
  });
}
