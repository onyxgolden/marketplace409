class ConstitutionGuard {
  constructor(constitution = null) {
    this.constitution = constitution;
  }

  load(constitutionPath) {
    const fs = require("fs");

    if (!fs.existsSync(constitutionPath)) {
      throw new Error(`Constitution file not found: ${constitutionPath}`);
    }

    this.constitution = JSON.parse(
      fs.readFileSync(constitutionPath, "utf8")
    );

    return this.constitution;
  }

  validateStepOrder(steps) {
    const rules = this.constitution?.rules || [];

    const violations = [];

    for (const rule of rules) {
      if (rule.type === "require_inspect_before_edit") {
        violations.push(
          ...this.checkInspectBeforeEdit(steps)
        );
      }

      if (rule.type === "require_test_after_edit") {
        violations.push(
          ...this.checkTestAfterEdit(steps)
        );
      }

      if (rule.type === "no_unverified_patches") {
        violations.push(
          ...this.checkPatchVerification(steps)
        );
      }
    }

    return {
      valid: violations.length === 0,
      violations,
    };
  }

  checkInspectBeforeEdit(steps) {
    const violations = [];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      if (step.action === "edit" || step.action === "apply_patch") {
        const prev = steps[i - 1];

        if (!prev || prev.action !== "inspect") {
          violations.push({
            type: "inspect_before_edit",
            index: i,
            message: "Edit or patch must be preceded by inspect step",
          });
        }
      }
    }

    return violations;
  }

  checkTestAfterEdit(steps) {
    const violations = [];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      if (step.action === "edit" || step.action === "apply_patch") {
        const next = steps[i + 1];

        if (!next || !next.action.includes("test")) {
          violations.push({
            type: "test_after_edit",
            index: i,
            message: "Edit or patch must be followed by test step",
          });
        }
      }
    }

    return violations;
  }

  checkPatchVerification(steps) {
    const violations = [];

    for (const step of steps) {
      if (step.action === "apply_patch" && !step.verify) {
        violations.push({
          type: "patch_verification_required",
          message: "Patch operations must include verify flag",
        });
      }
    }

    return violations;
  }
}

module.exports = ConstitutionGuard;
