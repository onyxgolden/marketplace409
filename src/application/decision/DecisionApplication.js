import { Decision } from "../../domains/decision/decision";
import { DecisionWorkflowService } from "../../domains/decision/decision-workflow.service";

function normalizeDecisionResult(decision) {
  return Object.freeze({
    type: "decision",
    decision,
    status: decision.status,
  });
}

export class DecisionApplication {
  constructor({
    workflowService = new DecisionWorkflowService(),
  } = {}) {
    this.workflowService = workflowService;
  }

  createDecision({
    id,
    context,
    recommendation,
    confidence,
    priority,
    status,
    selectedAction,
    outcome,
  }) {
    const decision = new Decision({
      id,
      context,
      recommendation,
      confidence,
      priority,
      status,
      selectedAction,
      outcome,
    });

    return normalizeDecisionResult(decision);
  }

  acceptDecision(decision, selectedAction = null) {
    return normalizeDecisionResult(
      this.workflowService.accept(
        decision,
        selectedAction,
      ),
    );
  }

  rejectDecision(decision, outcome = null) {
    return normalizeDecisionResult(
      this.workflowService.reject(
        decision,
        outcome,
      ),
    );
  }

  completeDecision(decision, outcome = null) {
    return normalizeDecisionResult(
      this.workflowService.complete(
        decision,
        outcome,
      ),
    );
  }

  buildSummary(decisions = []) {
    return Object.freeze({
      type: "decision-summary",
      count: decisions.length,
      decisions: Object.freeze([...decisions]),
    });
  }
}
