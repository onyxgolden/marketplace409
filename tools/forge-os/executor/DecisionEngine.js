class DecisionEngine {
  constructor() {
    this.state = {
      mode: "normal", // normal | repair | debug | skip
      lastMeaning: null,
    };
  }

  /**
   * CORE ENTRY
   * Takes semantic result + decides runtime behavior
   */
  decide(semanticResult, currentStepIndex, plan) {
    const decision = {
      action: "continue",
      modifiedIndex: currentStepIndex + 1,
      injectSteps: [],
    };

    this.state.lastMeaning = semanticResult.meaning;

    // -------------------------
    // ERROR → ENTER REPAIR MODE
    // -------------------------
    if (!semanticResult.success) {
      this.state.mode = "repair";

      decision.action = "retry";
      decision.modifiedIndex = currentStepIndex;

      return decision;
    }

    // -------------------------
    // DETECT TEST FAILURES → DEBUG MODE
    // -------------------------
    if (semanticResult.suggestedNextAction === "debug_flow") {
      this.state.mode = "debug";

      decision.action = "inject";
      decision.injectSteps = [
        {
          action: "inspect",
          description: "Debug state inspection",
          command: "git status",
        },
      ];

      return decision;
    }

    // -------------------------
    // NO CHANGES → SKIP UNNECESSARY STEPS
    // -------------------------
    if (semanticResult.meaning === "no_changes_detected") {
      this.state.mode = "skip";

      decision.action = "skip";
      decision.modifiedIndex = currentStepIndex + 2;

      return decision;
    }

    // -------------------------
    // NORMAL FLOW
    // -------------------------
    this.state.mode = "normal";
    return decision;
  }

  getState() {
    return this.state;
  }
}

module.exports = DecisionEngine;
