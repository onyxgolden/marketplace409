import { Decision } from "./decision";

export class DecisionWorkflowService {
  accept(decision: Decision, selectedAction: unknown = null): Decision {
    if (decision.status !== "open") {
      throw new Error(
        "Only open decisions can be accepted",
      );
    }

    return new Decision({
      id: decision.id,
      context: decision.context,
      recommendation: decision.recommendation,
      confidence: decision.confidence,
      priority: decision.priority,
      status: "accepted",
      selectedAction,
      outcome: decision.outcome,
    });
  }

  reject(decision: Decision, outcome: unknown = null): Decision {
    if (decision.status !== "open") {
      throw new Error(
        "Only open decisions can be rejected",
      );
    }

    return new Decision({
      id: decision.id,
      context: decision.context,
      recommendation: decision.recommendation,
      confidence: decision.confidence,
      priority: decision.priority,
      status: "rejected",
      selectedAction: decision.selectedAction,
      outcome,
    });
  }

  complete(decision: Decision, outcome: unknown = null): Decision {
    if (decision.status !== "accepted") {
      throw new Error(
        "Only accepted decisions can be completed",
      );
    }

    return new Decision({
      id: decision.id,
      context: decision.context,
      recommendation: decision.recommendation,
      confidence: decision.confidence,
      priority: decision.priority,
      status: "completed",
      selectedAction: decision.selectedAction,
      outcome,
    });
  }
}
