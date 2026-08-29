import { describe, expect, it } from "vitest";
import {
  startGuidedWorkflowSession,
  advanceGuidedWorkflowSession,
  goBackGuidedWorkflowSession,
  pauseGuidedWorkflowSession,
  resumeGuidedWorkflowSession,
  exitGuidedWorkflowSession,
  authorizeGuidedWorkflowSessionStart,
  sessionHasUnavailableSteps,
  GuidedWorkflowAuthorizationError,
} from "../advanceGuidedWorkflowSession.js";
import { validateWorkflowDefinition, EVALUATOR_RESULT_STATUS, GUIDED_WORKFLOW_SESSION_STATUS, WORKFLOW_STEP_CONSEQUENCE } from "../guidedWorkflowContracts.js";

const NOW = "2026-08-28T00:00:00.000Z";
const LATER = "2026-08-28T00:05:00.000Z";

function fixtureDefinition(overrides = {}) {
  return validateWorkflowDefinition({
    workflowId: "fixture.workflow",
    version: "1.0",
    title: "Fixture",
    purpose: "Testing.",
    applicableRoles: ["primary_owner"],
    completionEvaluatorId: "fixture-completion",
    steps: [
      { stepId: "step-a", semanticTargetId: "target-a", instruction: "A", stateEvaluatorId: "e", consequence: WORKFLOW_STEP_CONSEQUENCE.INFORMATIONAL, requiresExplicitConfirmation: false },
      { stepId: "step-b", semanticTargetId: "target-b", instruction: "B", stateEvaluatorId: "e", consequence: WORKFLOW_STEP_CONSEQUENCE.INFORMATIONAL, requiresExplicitConfirmation: false },
      { stepId: "step-c", semanticTargetId: "target-c", instruction: "C", stateEvaluatorId: "e", consequence: WORKFLOW_STEP_CONSEQUENCE.INFORMATIONAL, requiresExplicitConfirmation: false },
    ],
    ...overrides,
  });
}

function results(statusByStepId, evaluatedAt = NOW) {
  return Object.entries(statusByStepId).map(([stepId, status]) => ({ stepId, status, reasonCode: null, evaluatedAt }));
}

describe("authorizeGuidedWorkflowSessionStart", () => {
  it("rejects a missing actingUserId", () => {
    expect(() => authorizeGuidedWorkflowSessionStart({ actingUserId: "", canonicalOwnerId: "owner-1" }))
      .toThrow(GuidedWorkflowAuthorizationError);
  });

  it("rejects a missing canonicalOwnerId", () => {
    expect(() => authorizeGuidedWorkflowSessionStart({ actingUserId: "user-1", canonicalOwnerId: "" }))
      .toThrow(GuidedWorkflowAuthorizationError);
  });

  it("accepts a well-formed pair, keeping acting user and canonical owner distinct", () => {
    expect(() => authorizeGuidedWorkflowSessionStart({ actingUserId: "user-1", canonicalOwnerId: "owner-1" })).not.toThrow();
  });
});

describe("startGuidedWorkflowSession", () => {
  it("selects the first step that needs attention, in definition order", () => {
    const session = startGuidedWorkflowSession({
      sessionId: "session-1", workflowDefinition: fixtureDefinition(),
      evaluatorResults: results({ "step-a": EVALUATOR_RESULT_STATUS.NOT_APPLICABLE, "step-b": EVALUATOR_RESULT_STATUS.REQUIRED, "step-c": EVALUATOR_RESULT_STATUS.REQUIRED }),
      actingUserId: "user-1", canonicalOwnerId: "owner-1", now: NOW,
    });
    expect(session.currentStepId).toBe("step-b");
    expect(session.status).toBe(GUIDED_WORKFLOW_SESSION_STATUS.ACTIVE);
    expect(session.skippedSteps).toEqual([{ stepId: "step-a", reasonCode: "not_applicable" }]);
  });

  it("keeps acting user and canonical owner as distinct fields", () => {
    const session = startGuidedWorkflowSession({
      sessionId: "session-1", workflowDefinition: fixtureDefinition(),
      evaluatorResults: results({ "step-a": EVALUATOR_RESULT_STATUS.REQUIRED, "step-b": EVALUATOR_RESULT_STATUS.NOT_APPLICABLE, "step-c": EVALUATOR_RESULT_STATUS.NOT_APPLICABLE }),
      actingUserId: "co-owner-user-2", canonicalOwnerId: "primary-owner-1", now: NOW,
    });
    expect(session.actingUserId).toBe("co-owner-user-2");
    expect(session.canonicalOwnerId).toBe("primary-owner-1");
    expect(session.actingUserId).not.toBe(session.canonicalOwnerId);
  });

  it("completes immediately with no current step when nothing needs attention -- the 'nothing urgent' case", () => {
    const session = startGuidedWorkflowSession({
      sessionId: "session-1", workflowDefinition: fixtureDefinition(),
      evaluatorResults: results({ "step-a": EVALUATOR_RESULT_STATUS.NOT_APPLICABLE, "step-b": EVALUATOR_RESULT_STATUS.NOT_APPLICABLE, "step-c": EVALUATOR_RESULT_STATUS.NOT_APPLICABLE }),
      actingUserId: "user-1", canonicalOwnerId: "owner-1", now: NOW,
    });
    expect(session.currentStepId).toBeNull();
    expect(session.status).toBe(GUIDED_WORKFLOW_SESSION_STATUS.COMPLETED);
  });

  it("stops on a step requiring explicit confirmation rather than auto-skipping it", () => {
    const session = startGuidedWorkflowSession({
      sessionId: "session-1", workflowDefinition: fixtureDefinition(),
      evaluatorResults: results({ "step-a": EVALUATOR_RESULT_STATUS.NOT_APPLICABLE, "step-b": EVALUATOR_RESULT_STATUS.REQUIRES_CONFIRMATION, "step-c": EVALUATOR_RESULT_STATUS.NOT_APPLICABLE }),
      actingUserId: "user-1", canonicalOwnerId: "owner-1", now: NOW,
    });
    expect(session.currentStepId).toBe("step-b");
  });

  it("throws when an evaluator result is missing for a step in the definition, rather than assuming it's satisfied", () => {
    // step-a resolves as not_applicable so the search continues to step-b, which has no supplied
    // result -- if step-a were REQUIRED the search would stop there and never reach the gap.
    expect(() => startGuidedWorkflowSession({
      sessionId: "session-1", workflowDefinition: fixtureDefinition(),
      evaluatorResults: results({ "step-a": EVALUATOR_RESULT_STATUS.NOT_APPLICABLE }),
      actingUserId: "user-1", canonicalOwnerId: "owner-1", now: NOW,
    })).toThrow(GuidedWorkflowAuthorizationError);
  });
});

describe("advanceGuidedWorkflowSession", () => {
  const definition = fixtureDefinition();

  function activeSession() {
    return startGuidedWorkflowSession({
      sessionId: "session-1", workflowDefinition: definition,
      evaluatorResults: results({ "step-a": EVALUATOR_RESULT_STATUS.REQUIRED, "step-b": EVALUATOR_RESULT_STATUS.REQUIRED, "step-c": EVALUATOR_RESULT_STATUS.NOT_APPLICABLE }),
      actingUserId: "user-1", canonicalOwnerId: "owner-1", now: NOW,
    });
  }

  it("advances to the next step that still needs attention, re-evaluated from fresh results", () => {
    const session = activeSession();
    const advanced = advanceGuidedWorkflowSession(session, definition, results({ "step-a": EVALUATOR_RESULT_STATUS.REQUIRED, "step-b": EVALUATOR_RESULT_STATUS.REQUIRED, "step-c": EVALUATOR_RESULT_STATUS.NOT_APPLICABLE }), "owner-1", LATER);
    expect(advanced.currentStepId).toBe("step-b");
    expect(advanced.completedStepIds).toEqual(["step-a"]);
  });

  it("does not complete a step just because advance() was called -- a fresh, real evaluator result is required every time", () => {
    // Even though step-a is already behind us, calling advance() again always re-derives from the
    // evaluatorResults argument supplied to *this* call, not from any client-side assumption. Passing
    // stale results where step-b is now genuinely resolved (not_applicable) causes it to be skipped
    // with a reason code, not silently marked "complete" from a bare click.
    const session = activeSession();
    const advanced = advanceGuidedWorkflowSession(session, definition, results({ "step-a": EVALUATOR_RESULT_STATUS.REQUIRED, "step-b": EVALUATOR_RESULT_STATUS.NOT_APPLICABLE, "step-c": EVALUATOR_RESULT_STATUS.NOT_APPLICABLE }), "owner-1", LATER);
    expect(advanced.currentStepId).toBeNull();
    expect(advanced.status).toBe(GUIDED_WORKFLOW_SESSION_STATUS.COMPLETED);
    expect(advanced.skippedSteps.find((s) => s.stepId === "step-b").reasonCode).toBe("not_applicable");
  });

  it("rejects advancing a session for a different workspace than the caller's own", () => {
    const session = activeSession();
    expect(() => advanceGuidedWorkflowSession(session, definition, results({ "step-a": EVALUATOR_RESULT_STATUS.REQUIRED, "step-b": EVALUATOR_RESULT_STATUS.REQUIRED, "step-c": EVALUATOR_RESULT_STATUS.NOT_APPLICABLE }), "a-different-owner", LATER))
      .toThrow(GuidedWorkflowAuthorizationError);
  });

  it("rejects advancing a paused session", () => {
    const session = pauseGuidedWorkflowSession(activeSession(), "owner-1", NOW);
    expect(() => advanceGuidedWorkflowSession(session, definition, results({ "step-a": EVALUATOR_RESULT_STATUS.REQUIRED, "step-b": EVALUATOR_RESULT_STATUS.REQUIRED, "step-c": EVALUATOR_RESULT_STATUS.NOT_APPLICABLE }), "owner-1", LATER))
      .toThrow(GuidedWorkflowAuthorizationError);
  });
});

describe("goBackGuidedWorkflowSession", () => {
  const definition = fixtureDefinition();

  it("moves to the previous step that still needs attention", () => {
    const allRequired = results({ "step-a": EVALUATOR_RESULT_STATUS.REQUIRED, "step-b": EVALUATOR_RESULT_STATUS.REQUIRED, "step-c": EVALUATOR_RESULT_STATUS.REQUIRED });
    const session = startGuidedWorkflowSession({
      sessionId: "session-1", workflowDefinition: definition, evaluatorResults: allRequired,
      actingUserId: "user-1", canonicalOwnerId: "owner-1", now: NOW,
    });
    const advanced = advanceGuidedWorkflowSession(session, definition, allRequired, "owner-1", LATER);
    expect(advanced.currentStepId).toBe("step-b");
    const back = goBackGuidedWorkflowSession(advanced, definition, allRequired, "owner-1", LATER);
    expect(back.currentStepId).toBe("step-a");
  });

  it("skips an earlier step that's no longer applicable, matching forward-skip behavior", () => {
    const session = startGuidedWorkflowSession({
      sessionId: "session-1", workflowDefinition: definition,
      evaluatorResults: results({ "step-a": EVALUATOR_RESULT_STATUS.NOT_APPLICABLE, "step-b": EVALUATOR_RESULT_STATUS.REQUIRED, "step-c": EVALUATOR_RESULT_STATUS.REQUIRED }),
      actingUserId: "user-1", canonicalOwnerId: "owner-1", now: NOW,
    });
    expect(session.currentStepId).toBe("step-b");
    const advanced = advanceGuidedWorkflowSession(session, definition, results({ "step-a": EVALUATOR_RESULT_STATUS.NOT_APPLICABLE, "step-b": EVALUATOR_RESULT_STATUS.REQUIRED, "step-c": EVALUATOR_RESULT_STATUS.REQUIRED }), "owner-1", LATER);
    expect(advanced.currentStepId).toBe("step-c");
    const back = goBackGuidedWorkflowSession(advanced, definition, results({ "step-a": EVALUATOR_RESULT_STATUS.NOT_APPLICABLE, "step-b": EVALUATOR_RESULT_STATUS.REQUIRED, "step-c": EVALUATOR_RESULT_STATUS.REQUIRED }), "owner-1", LATER);
    expect(back.currentStepId).toBe("step-b");
  });

  it("rejects going back from the first step", () => {
    const allRequired = results({ "step-a": EVALUATOR_RESULT_STATUS.REQUIRED, "step-b": EVALUATOR_RESULT_STATUS.REQUIRED, "step-c": EVALUATOR_RESULT_STATUS.REQUIRED });
    const session = startGuidedWorkflowSession({
      sessionId: "session-1", workflowDefinition: definition, evaluatorResults: allRequired,
      actingUserId: "user-1", canonicalOwnerId: "owner-1", now: NOW,
    });
    expect(() => goBackGuidedWorkflowSession(session, definition, allRequired, "owner-1", LATER)).toThrow(GuidedWorkflowAuthorizationError);
  });

  it("rejects going back across a workspace boundary", () => {
    const allRequired = results({ "step-a": EVALUATOR_RESULT_STATUS.REQUIRED, "step-b": EVALUATOR_RESULT_STATUS.REQUIRED, "step-c": EVALUATOR_RESULT_STATUS.REQUIRED });
    const session = startGuidedWorkflowSession({
      sessionId: "session-1", workflowDefinition: definition, evaluatorResults: allRequired,
      actingUserId: "user-1", canonicalOwnerId: "owner-1", now: NOW,
    });
    const advanced = advanceGuidedWorkflowSession(session, definition, allRequired, "owner-1", LATER);
    expect(() => goBackGuidedWorkflowSession(advanced, definition, allRequired, "a-different-owner", LATER)).toThrow(GuidedWorkflowAuthorizationError);
  });
});

describe("pause / resume / exit", () => {
  const definition = fixtureDefinition();

  function activeSession() {
    return startGuidedWorkflowSession({
      sessionId: "session-1", workflowDefinition: definition,
      evaluatorResults: results({ "step-a": EVALUATOR_RESULT_STATUS.REQUIRED, "step-b": EVALUATOR_RESULT_STATUS.REQUIRED, "step-c": EVALUATOR_RESULT_STATUS.REQUIRED }),
      actingUserId: "user-1", canonicalOwnerId: "owner-1", now: NOW,
    });
  }

  it("pauses and resumes, preserving the current step, workflow version, and workspace", () => {
    const paused = pauseGuidedWorkflowSession(activeSession(), "owner-1", LATER);
    expect(paused.status).toBe(GUIDED_WORKFLOW_SESSION_STATUS.PAUSED);
    const resumed = resumeGuidedWorkflowSession(paused, definition, "owner-1", LATER);
    expect(resumed.status).toBe(GUIDED_WORKFLOW_SESSION_STATUS.ACTIVE);
    expect(resumed.currentStepId).toBe(paused.currentStepId);
    expect(resumed.workflowVersion).toBe(definition.version);
  });

  it("rejects resuming when the workflow version has moved on since the session was paused", () => {
    const paused = pauseGuidedWorkflowSession(activeSession(), "owner-1", LATER);
    const newerDefinition = fixtureDefinition({ version: "2.0" });
    expect(() => resumeGuidedWorkflowSession(paused, newerDefinition, "owner-1", LATER)).toThrow(GuidedWorkflowAuthorizationError);
  });

  it("rejects resuming a session across a workspace boundary", () => {
    const paused = pauseGuidedWorkflowSession(activeSession(), "owner-1", LATER);
    expect(() => resumeGuidedWorkflowSession(paused, definition, "a-different-owner", LATER)).toThrow(GuidedWorkflowAuthorizationError);
  });

  it("rejects pausing an already-paused session", () => {
    const paused = pauseGuidedWorkflowSession(activeSession(), "owner-1", LATER);
    expect(() => pauseGuidedWorkflowSession(paused, "owner-1", LATER)).toThrow(GuidedWorkflowAuthorizationError);
  });

  it("exits from an active session", () => {
    const exited = exitGuidedWorkflowSession(activeSession(), "owner-1", LATER);
    expect(exited.status).toBe(GUIDED_WORKFLOW_SESSION_STATUS.EXITED);
  });

  it("rejects exiting across a workspace boundary", () => {
    expect(() => exitGuidedWorkflowSession(activeSession(), "a-different-owner", LATER)).toThrow(GuidedWorkflowAuthorizationError);
  });
});

describe("UNAVAILABLE steps (partial-data source)", () => {
  const definition = fixtureDefinition();

  it("skips an UNAVAILABLE step with its own distinct reason code, never conflating it with not_applicable or already_complete", () => {
    const session = startGuidedWorkflowSession({
      sessionId: "session-1", workflowDefinition: definition,
      evaluatorResults: results({ "step-a": EVALUATOR_RESULT_STATUS.UNAVAILABLE, "step-b": EVALUATOR_RESULT_STATUS.NOT_APPLICABLE, "step-c": EVALUATOR_RESULT_STATUS.NOT_APPLICABLE }),
      actingUserId: "user-1", canonicalOwnerId: "owner-1", now: NOW,
    });
    expect(session.currentStepId).toBeNull();
    expect(session.status).toBe(GUIDED_WORKFLOW_SESSION_STATUS.COMPLETED);
    const skippedA = session.skippedSteps.find((s) => s.stepId === "step-a");
    expect(skippedA.reasonCode).toBe("unavailable");
    expect(skippedA.reasonCode).not.toBe("not_applicable");
    expect(skippedA.reasonCode).not.toBe("already_complete");
  });

  it("does not treat an UNAVAILABLE step as needing attention -- it's walked past, not stopped on", () => {
    const session = startGuidedWorkflowSession({
      sessionId: "session-1", workflowDefinition: definition,
      evaluatorResults: results({ "step-a": EVALUATOR_RESULT_STATUS.UNAVAILABLE, "step-b": EVALUATOR_RESULT_STATUS.REQUIRED, "step-c": EVALUATOR_RESULT_STATUS.NOT_APPLICABLE }),
      actingUserId: "user-1", canonicalOwnerId: "owner-1", now: NOW,
    });
    expect(session.currentStepId).toBe("step-b");
  });

  it("sessionHasUnavailableSteps is true whenever any step was skipped as unavailable, even if the session reached COMPLETED", () => {
    const session = startGuidedWorkflowSession({
      sessionId: "session-1", workflowDefinition: definition,
      evaluatorResults: results({ "step-a": EVALUATOR_RESULT_STATUS.UNAVAILABLE, "step-b": EVALUATOR_RESULT_STATUS.NOT_APPLICABLE, "step-c": EVALUATOR_RESULT_STATUS.NOT_APPLICABLE }),
      actingUserId: "user-1", canonicalOwnerId: "owner-1", now: NOW,
    });
    expect(session.status).toBe(GUIDED_WORKFLOW_SESSION_STATUS.COMPLETED);
    expect(sessionHasUnavailableSteps(session)).toBe(true);
  });

  it("sessionHasUnavailableSteps is false for an ordinary, fully-evaluated completed session", () => {
    const session = startGuidedWorkflowSession({
      sessionId: "session-1", workflowDefinition: definition,
      evaluatorResults: results({ "step-a": EVALUATOR_RESULT_STATUS.NOT_APPLICABLE, "step-b": EVALUATOR_RESULT_STATUS.NOT_APPLICABLE, "step-c": EVALUATOR_RESULT_STATUS.NOT_APPLICABLE }),
      actingUserId: "user-1", canonicalOwnerId: "owner-1", now: NOW,
    });
    expect(sessionHasUnavailableSteps(session)).toBe(false);
  });

  it("sessionHasUnavailableSteps remains true after advancing past additional required steps", () => {
    const session = startGuidedWorkflowSession({
      sessionId: "session-1", workflowDefinition: definition,
      evaluatorResults: results({ "step-a": EVALUATOR_RESULT_STATUS.UNAVAILABLE, "step-b": EVALUATOR_RESULT_STATUS.REQUIRED, "step-c": EVALUATOR_RESULT_STATUS.NOT_APPLICABLE }),
      actingUserId: "user-1", canonicalOwnerId: "owner-1", now: NOW,
    });
    const advanced = advanceGuidedWorkflowSession(session, definition, results({ "step-a": EVALUATOR_RESULT_STATUS.UNAVAILABLE, "step-b": EVALUATOR_RESULT_STATUS.REQUIRED, "step-c": EVALUATOR_RESULT_STATUS.NOT_APPLICABLE }), "owner-1", LATER);
    expect(advanced.status).toBe(GUIDED_WORKFLOW_SESSION_STATUS.COMPLETED);
    expect(sessionHasUnavailableSteps(advanced)).toBe(true);
  });
});
