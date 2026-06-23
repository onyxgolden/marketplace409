class ExecutionBrain {
  constructor(planner) {
    this.planner = planner;
    this.failures = [];
  }

  recordFailure(step, error) {
    this.failures.push({
      step,
      error: error?.message || String(error),
      action: step?.action,
      command: step?.command,
      timestamp: new Date().toISOString(),
    });
  }

  analyze() {
    if (this.failures.length === 0) {
      return { status: "clean" };
    }

    return {
      status: "failed",
      total: this.failures.length,
      breakdown: this.categorizeFailures(),
      rootCauses: this.detectRootCauses(),
    };
  }

  categorizeFailures() {
    const map = {};

    for (const f of this.failures) {
      const key = f.action || "unknown";
      map[key] = (map[key] || 0) + 1;
    }

    return map;
  }

  detectRootCauses() {
    const causes = [];

    for (const f of this.failures) {
      const msg = f.error.toLowerCase();

      if (msg.includes("blocked")) {
        causes.push({
          type: "security_block",
          suggestion: "Remove or adjust blocked command pattern",
        });
      }

      if (msg.includes("not found")) {
        causes.push({
          type: "missing_dependency",
          suggestion: "Install or correct missing command/tool",
        });
      }

      if (msg.includes("permission")) {
        causes.push({
          type: "permission_issue",
          suggestion: "Check file or command permissions",
        });
      }

      if (msg.includes("syntax")) {
        causes.push({
          type: "syntax_error",
          suggestion: "Fix command or script syntax",
        });
      }
    }

    return causes;
  }

  shouldReplan() {
    return this.failures.length > 0;
  }

  /**
   * NEW: targeted fix instead of full replanning
   */
  suggestFix(step) {
    const analysis = this.analyze();

    if (analysis.status === "clean") return null;

    const last = this.failures[this.failures.length - 1];

    return {
      originalStep: step,
      issue: last.error,
      suggestedAction: this.mapFix(last),
    };
  }

  mapFix(failure) {
    const msg = failure.error.toLowerCase();

    if (msg.includes("blocked")) {
      return "modify_command";
    }

    if (msg.includes("not found")) {
      return "replace_command";
    }

    if (msg.includes("permission")) {
      return "adjust_permissions";
    }

    if (msg.includes("syntax")) {
      return "repair_syntax";
    }

    return "replan";
  }

  /**
   * OLD fallback (still used by forge.js)
   */
  replan(intent) {
    console.log("EXECUTION BRAIN: fallback full replan");

    const summary = this.analyze();

    const adjustedIntent =
      intent +
      " (recovered from failures: " +
      JSON.stringify(summary.breakdown) +
      ")";

    return this.planner.generatePlan(adjustedIntent);
  }

  reset() {
    this.failures = [];
  }
}

module.exports = ExecutionBrain;
