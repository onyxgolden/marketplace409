import { describe, expect, it } from "vitest";
import {
  Decision,
  type DecisionStatus,
} from "../decision";
import { DecisionWorkflowService } from "../decision-workflow.service";

function createDecision(
  status: DecisionStatus = "open",
) {
  return new Decision({
    id: "decision-1",
    context: {
      property: "Main Street",
    },
    recommendation: "Review cash flow",
    confidence: 0.85,
    priority: "high",
    status,
  });
}

describe("DecisionWorkflowService", () => {
  it("accepts an open decision", () => {
    const service = new DecisionWorkflowService();

    const accepted = service.accept(
      createDecision(),
      "Increase reserve",
    );

    expect(accepted.status).toBe("accepted");
    expect(accepted.selectedAction).toBe(
      "Increase reserve",
    );
    expect(Object.isFrozen(accepted)).toBe(true);
  });

  it("rejects an open decision", () => {
    const service = new DecisionWorkflowService();

    const rejected = service.reject(
      createDecision(),
      "Not needed",
    );

    expect(rejected.status).toBe("rejected");
    expect(rejected.outcome).toBe("Not needed");
  });

  it("completes an accepted decision", () => {
    const service = new DecisionWorkflowService();

    const accepted = service.accept(
      createDecision(),
      "Execute action",
    );

    const completed = service.complete(
      accepted,
      "Completed successfully",
    );

    expect(completed.status).toBe("completed");
    expect(completed.outcome).toBe(
      "Completed successfully",
    );
  });

  it("rejects invalid lifecycle transitions", () => {
    const service = new DecisionWorkflowService();

    expect(() =>
      service.complete(createDecision(), "invalid"),
    ).toThrow();

    expect(() =>
      service.accept(
        createDecision("completed"),
      ),
    ).toThrow();
  });
});

