export class FinancialDecisionApplication {
  constructor({
    decisionApplication,
  }) {
    if (!decisionApplication) {
      throw new Error(
        "FinancialDecisionApplication requires a decision application.",
      );
    }

    this.decisionApplication = decisionApplication;
  }

  buildDecisions({
    recommendations = [],
    kpis = {},
    health = {},
  }) {
    const decisions = recommendations.map(
      (recommendation, index) =>
        this.decisionApplication.createDecision({
          id: `financial-decision-${index + 1}`,
          context: {
            kpis,
            health,
          },
          recommendation,
          confidence: 0.8,
          priority: "medium",
        }),
    );

    return Object.freeze({
      type: "financial-decisions",
      decisions: Object.freeze(decisions),
      source: Object.freeze({
        authority:
          "financial-event-repository-backed-read-models",
        derivedFrom: "financial-intelligence",
      }),
    });
  }
}
