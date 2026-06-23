class SemanticReasoner {
  constructor() {}

  /**
   * PRIMARY ENTRY:
   * interpret execution result meaningfully
   */
  analyze(step, result) {
    const output = (result.stdout || "") + (result.stderr || "");
    const text = output.toLowerCase();

    return {
      success: this.isSuccess(result, text),
      meaning: this.extractMeaning(step, text),
      suggestedNextAction: this.suggestNext(step, text),
    };
  }

  /**
   * BEYOND EXIT CODE
   */
  isSuccess(result, text) {
    if (result.ok === false) return false;

    const failureSignals = [
      "error",
      "failed",
      "exception",
      "not found",
      "denied",
    ];

    return !failureSignals.some((s) => text.includes(s));
  }

  /**
   * WHAT DID THIS STEP ACTUALLY DO?
   */
  extractMeaning(step, text) {
    if (step.command?.includes("git status")) {
      return "repository_state_check";
    }

    if (step.command?.includes("find")) {
      return "filesystem_introspection";
    }

    if (step.command?.includes("npm test")) {
      return "test_execution";
    }

    if (text.includes("modified")) {
      return "detected_changes";
    }

    if (text.includes("clean")) {
      return "no_changes_detected";
    }

    return "unknown_operation";
  }

  /**
   * DECIDE NEXT STEP LOGICALLY
   */
  suggestNext(step, text) {
    if (text.includes("error")) {
      return "repair_needed";
    }

    if (step.action === "inspect" && text.includes("modified")) {
      return "consider_commit_flow";
    }

    if (step.command?.includes("test") && text.includes("fail")) {
      return "debug_flow";
    }

    return "continue";
  }
}

module.exports = SemanticReasoner;
