import { describe, expect, it } from "vitest";
import {
  MalformedGuidedWorkflowContractError,
  WORKFLOW_STEP_CONSEQUENCE,
  EVALUATOR_RESULT_STATUS,
  GUIDED_WORKFLOW_SESSION_STATUS,
  validateSemanticTarget,
  validateWorkflowStep,
  validateWorkflowDefinition,
  validateEvaluatorResult,
  validateGuidedWorkflowSession,
} from "../guidedWorkflowContracts.js";

function validStep(overrides = {}) {
  return {
    stepId: "step-1",
    semanticTargetId: "target-1",
    instruction: "Do the thing.",
    stateEvaluatorId: "evaluator-1",
    consequence: WORKFLOW_STEP_CONSEQUENCE.INFORMATIONAL,
    requiresExplicitConfirmation: false,
    ...overrides,
  };
}

function validDefinition(overrides = {}) {
  return {
    workflowId: "workflow-1",
    version: "1.0",
    title: "Test workflow",
    purpose: "Testing.",
    applicableRoles: ["primary_owner", "co_owner"],
    steps: [validStep()],
    completionEvaluatorId: "completion-evaluator-1",
    ...overrides,
  };
}

function validSession(overrides = {}) {
  return {
    sessionId: "session-1",
    workflowId: "workflow-1",
    workflowVersion: "1.0",
    actingUserId: "user-1",
    canonicalOwnerId: "owner-1",
    currentStepId: "step-1",
    completedStepIds: [],
    skippedSteps: [],
    status: GUIDED_WORKFLOW_SESSION_STATUS.ACTIVE,
    startedAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z",
    ...overrides,
  };
}

describe("validateSemanticTarget", () => {
  it("accepts a well-formed target", () => {
    const target = validateSemanticTarget({ targetId: "rental.tenant.add", description: "Add tenant button" });
    expect(target).toEqual({ targetId: "rental.tenant.add", description: "Add tenant button" });
  });

  it("fails closed on a missing targetId", () => {
    expect(() => validateSemanticTarget({ description: "x" })).toThrow(MalformedGuidedWorkflowContractError);
  });

  it("fails closed on a missing description", () => {
    expect(() => validateSemanticTarget({ targetId: "x" })).toThrow(MalformedGuidedWorkflowContractError);
  });
});

describe("validateWorkflowStep", () => {
  it("accepts a well-formed informational step", () => {
    const step = validateWorkflowStep(validStep());
    expect(step.stepId).toBe("step-1");
    expect(step.explanation).toBeNull();
    expect(Object.isFrozen(step)).toBe(true);
  });

  it("rejects an unknown consequence value", () => {
    expect(() => validateWorkflowStep(validStep({ consequence: "destructive" }))).toThrow(MalformedGuidedWorkflowContractError);
  });

  it("rejects a consequential step that does not require explicit confirmation", () => {
    expect(() => validateWorkflowStep(validStep({
      consequence: WORKFLOW_STEP_CONSEQUENCE.CONSEQUENTIAL, requiresExplicitConfirmation: false,
    }))).toThrow(/requiresExplicitConfirmation/);
  });

  it("accepts a consequential step that does require explicit confirmation", () => {
    const step = validateWorkflowStep(validStep({
      consequence: WORKFLOW_STEP_CONSEQUENCE.CONSEQUENTIAL, requiresExplicitConfirmation: true,
    }));
    expect(step.consequence).toBe(WORKFLOW_STEP_CONSEQUENCE.CONSEQUENTIAL);
  });

  it("rejects a missing stateEvaluatorId", () => {
    expect(() => validateWorkflowStep(validStep({ stateEvaluatorId: "" }))).toThrow(MalformedGuidedWorkflowContractError);
  });
});

describe("validateWorkflowDefinition", () => {
  it("accepts a well-formed definition", () => {
    const definition = validateWorkflowDefinition(validDefinition());
    expect(definition.workflowId).toBe("workflow-1");
    expect(definition.steps).toHaveLength(1);
    expect(Object.isFrozen(definition)).toBe(true);
    expect(Object.isFrozen(definition.steps)).toBe(true);
  });

  it("fails closed on an empty steps array", () => {
    expect(() => validateWorkflowDefinition(validDefinition({ steps: [] }))).toThrow(MalformedGuidedWorkflowContractError);
  });

  it("fails closed on duplicate stepIds", () => {
    expect(() => validateWorkflowDefinition(validDefinition({
      steps: [validStep({ stepId: "dup" }), validStep({ stepId: "dup" })],
    }))).toThrow(/duplicate stepId/);
  });

  it("fails closed when a step is malformed", () => {
    expect(() => validateWorkflowDefinition(validDefinition({
      steps: [validStep({ instruction: "" })],
    }))).toThrow(MalformedGuidedWorkflowContractError);
  });

  it("fails closed on an empty applicableRoles array", () => {
    expect(() => validateWorkflowDefinition(validDefinition({ applicableRoles: [] }))).toThrow(MalformedGuidedWorkflowContractError);
  });
});

describe("validateEvaluatorResult", () => {
  it("accepts a well-formed result", () => {
    const result = validateEvaluatorResult({
      stepId: "step-1", status: EVALUATOR_RESULT_STATUS.REQUIRED, evaluatedAt: "2026-08-28T00:00:00.000Z",
    });
    expect(result.status).toBe(EVALUATOR_RESULT_STATUS.REQUIRED);
    expect(result.reasonCode).toBeNull();
  });

  it("fails closed on an unknown status", () => {
    expect(() => validateEvaluatorResult({
      stepId: "step-1", status: "unknown_status", evaluatedAt: "2026-08-28T00:00:00.000Z",
    })).toThrow(MalformedGuidedWorkflowContractError);
  });
});

describe("validateGuidedWorkflowSession", () => {
  it("accepts a well-formed session", () => {
    const session = validateGuidedWorkflowSession(validSession());
    expect(session.status).toBe(GUIDED_WORKFLOW_SESSION_STATUS.ACTIVE);
    expect(Object.isFrozen(session)).toBe(true);
  });

  it("fails closed when actingUserId and canonicalOwnerId are both missing", () => {
    expect(() => validateGuidedWorkflowSession(validSession({ actingUserId: "" }))).toThrow(MalformedGuidedWorkflowContractError);
  });

  it("fails closed on a malformed skippedSteps entry", () => {
    expect(() => validateGuidedWorkflowSession(validSession({
      skippedSteps: [{ stepId: "step-2" }],
    }))).toThrow(/skippedSteps/);
  });

  it("fails closed on an unknown status", () => {
    expect(() => validateGuidedWorkflowSession(validSession({ status: "vanished" }))).toThrow(MalformedGuidedWorkflowContractError);
  });

  it("accepts a null currentStepId (session with no remaining required step)", () => {
    const session = validateGuidedWorkflowSession(validSession({ currentStepId: null, status: GUIDED_WORKFLOW_SESSION_STATUS.COMPLETED }));
    expect(session.currentStepId).toBeNull();
  });
});
