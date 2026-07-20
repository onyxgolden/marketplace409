import { describe, expect, it } from "vitest";
import { DecisionApplication } from "./DecisionApplication";

describe("DecisionApplication", () => {
  it("creates a decision through the domain boundary", () => {
    const application = new DecisionApplication();

    const result = application.createDecision({
      id: "decision-1",
      context: {
        property: "Main Street",
      },
      recommendation: "Review expenses",
      confidence: 0.8,
      priority: "high",
    });

    expect(result.type).toBe("decision");
    expect(result.status).toBe("open");
    expect(result.decision.id).toBe("decision-1");
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("preserves decision lifecycle state", () => {
    const application = new DecisionApplication();

    const result = application.createDecision({
      id: "decision-2",
      context: {},
      recommendation: "Approve",
      confidence: 0.9,
      priority: "urgent",
      status: "accepted",
    });

    expect(result.status).toBe("accepted");
  });

  it("accepts a decision through workflow orchestration", () => {
    const application = new DecisionApplication();

    const created = application.createDecision({
      id: "decision-3",
      context: {},
      recommendation: "Increase reserve",
      confidence: 0.85,
      priority: "high",
    });

    const accepted = application.acceptDecision(
      created.decision,
      "Increase reserve",
    );

    expect(accepted.status).toBe("accepted");
    expect(accepted.decision.selectedAction).toBe(
      "Increase reserve",
    );
  });

  it("rejects a decision through workflow orchestration", () => {
    const application = new DecisionApplication();

    const created = application.createDecision({
      id: "decision-4",
      context: {},
      recommendation: "Change strategy",
      confidence: 0.7,
      priority: "medium",
    });

    const rejected = application.rejectDecision(
      created.decision,
      "Not required",
    );

    expect(rejected.status).toBe("rejected");
    expect(rejected.decision.outcome).toBe(
      "Not required",
    );
  });

  it("completes an accepted decision through workflow orchestration", () => {
    const application = new DecisionApplication();

    const created = application.createDecision({
      id: "decision-5",
      context: {},
      recommendation: "Execute action",
      confidence: 0.95,
      priority: "urgent",
    });

    const accepted = application.acceptDecision(
      created.decision,
      "Execute action",
    );

    const completed = application.completeDecision(
      accepted.decision,
      "Completed",
    );

    expect(completed.status).toBe("completed");
    expect(completed.decision.outcome).toBe(
      "Completed",
    );
  });

  it("builds an immutable decision summary", () => {
    const application = new DecisionApplication();

    const summary = application.buildSummary([
      {
        id: "decision-1",
      },
    ]);

    expect(summary.type).toBe("decision-summary");
    expect(summary.count).toBe(1);
    expect(Object.isFrozen(summary)).toBe(true);
    expect(Object.isFrozen(summary.decisions)).toBe(true);
  });
});
