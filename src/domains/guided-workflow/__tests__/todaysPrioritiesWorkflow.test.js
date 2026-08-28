import { describe, expect, it } from "vitest";
import {
  buildTodaysPrioritiesWorkflowDefinition,
  buildTodaysPrioritiesEvaluatorResults,
  evaluateTodaysPrioritiesStep,
  TODAYS_PRIORITIES_WORKFLOW_ID,
} from "../todaysPrioritiesWorkflow.js";
import { EVALUATOR_RESULT_STATUS } from "../guidedWorkflowContracts.js";

describe("buildTodaysPrioritiesWorkflowDefinition", () => {
  it("produces a valid, versioned definition covering the full needsAttention vocabulary", () => {
    const definition = buildTodaysPrioritiesWorkflowDefinition();
    expect(definition.workflowId).toBe(TODAYS_PRIORITIES_WORKFLOW_ID);
    expect(definition.steps.map((step) => step.stepId)).toEqual([
      "overdue-forge", "urgent-maintenance", "externally-managed", "leases-expiring-soon",
      "vacancies", "readiness-gaps", "routine-maintenance", "awaiting-settlement", "support-cases",
    ]);
  });

  it("is entirely non-mutating -- every step is informational and needs no confirmation", () => {
    const definition = buildTodaysPrioritiesWorkflowDefinition();
    for (const step of definition.steps) {
      expect(step.consequence).toBe("informational");
      expect(step.requiresExplicitConfirmation).toBe(false);
    }
  });

  it("attaches supplied explanation content by step id", () => {
    const definition = buildTodaysPrioritiesWorkflowDefinition({ "overdue-forge": "Because unpaid rent compounds." });
    const step = definition.steps.find((s) => s.stepId === "overdue-forge");
    expect(step.explanation).toBe("Because unpaid rent compounds.");
  });

  it("leaves explanation null when none is supplied for a step", () => {
    const definition = buildTodaysPrioritiesWorkflowDefinition({});
    const step = definition.steps.find((s) => s.stepId === "vacancies");
    expect(step.explanation).toBeNull();
  });
});

describe("evaluateTodaysPrioritiesStep", () => {
  const definition = buildTodaysPrioritiesWorkflowDefinition();
  const overdueStep = definition.steps.find((s) => s.stepId === "overdue-forge");

  it("marks a step required when its id is present in the live needsAttention set", () => {
    const result = evaluateTodaysPrioritiesStep(overdueStep, new Set(["overdue-forge"]), "2026-08-28T00:00:00.000Z");
    expect(result.status).toBe(EVALUATOR_RESULT_STATUS.REQUIRED);
    expect(result.reasonCode).toBe("present_in_needs_attention");
  });

  it("marks a step not applicable when its id is absent from the live needsAttention set", () => {
    const result = evaluateTodaysPrioritiesStep(overdueStep, new Set(), "2026-08-28T00:00:00.000Z");
    expect(result.status).toBe(EVALUATOR_RESULT_STATUS.NOT_APPLICABLE);
    expect(result.reasonCode).toBe("absent_from_needs_attention");
  });
});

describe("buildTodaysPrioritiesEvaluatorResults", () => {
  const definition = buildTodaysPrioritiesWorkflowDefinition();

  it("evaluates every step against the live needsAttention queue", () => {
    const needsAttention = [
      { id: "overdue-forge", severity: "critical", label: "x", destination: "charges" },
      { id: "vacancies", severity: "warning", label: "y", destination: "setup" },
    ];
    const results = buildTodaysPrioritiesEvaluatorResults(definition, needsAttention, "2026-08-28T00:00:00.000Z");
    expect(results).toHaveLength(9);
    const required = results.filter((r) => r.status === EVALUATOR_RESULT_STATUS.REQUIRED).map((r) => r.stepId);
    expect(required.sort()).toEqual(["overdue-forge", "vacancies"]);
  });

  it("marks every step not applicable when nothing needs attention -- the 'nothing urgent' case", () => {
    const results = buildTodaysPrioritiesEvaluatorResults(definition, [], "2026-08-28T00:00:00.000Z");
    expect(results.every((r) => r.status === EVALUATOR_RESULT_STATUS.NOT_APPLICABLE)).toBe(true);
  });

  it("never invents a required step that isn't actually present in real data", () => {
    // Regression guard for "never invent urgency" (design doc Section 12) -- an unrelated id in the
    // live queue must not accidentally satisfy or affect any of the nine known steps.
    const results = buildTodaysPrioritiesEvaluatorResults(
      definition,
      [{ id: "some-future-attention-type", severity: "info", label: "z", destination: "overview" }],
      "2026-08-28T00:00:00.000Z",
    );
    expect(results.every((r) => r.status === EVALUATOR_RESULT_STATUS.NOT_APPLICABLE)).toBe(true);
  });
});
