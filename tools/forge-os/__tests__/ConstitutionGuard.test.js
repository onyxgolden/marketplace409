import {
  describe,
  expect,
  it,
} from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

const ConstitutionGuard = require(
  "../guards/ConstitutionGuard.js",
);

function createGuard(ruleTypes) {
  return new ConstitutionGuard({
    rules: ruleTypes.map((type) => ({
      type,
    })),
  });
}

describe("ConstitutionGuard", () => {
  it("accepts a compliant inspect-edit-test sequence", () => {
    const guard = createGuard([
      "require_inspect_before_edit",
      "require_test_after_edit",
    ]);

    const result = guard.validateStepOrder([
      {
        action: "inspect",
      },
      {
        action: "edit",
      },
      {
        action: "run_tests",
      },
    ]);

    expect(result).toEqual({
      valid: true,
      violations: [],
    });
  });

  it("rejects edits that are not immediately preceded by inspection", () => {
    const guard = createGuard([
      "require_inspect_before_edit",
    ]);

    const result = guard.validateStepOrder([
      {
        action: "edit",
      },
    ]);

    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      {
        type: "inspect_before_edit",
        index: 0,
        message:
          "Edit or patch must be preceded by inspect step",
      },
    ]);
  });

  it("rejects edits that are not immediately followed by tests", () => {
    const guard = createGuard([
      "require_test_after_edit",
    ]);

    const result = guard.validateStepOrder([
      {
        action: "edit",
      },
      {
        action: "build_project",
      },
    ]);

    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      {
        type: "test_after_edit",
        index: 0,
        message:
          "Edit or patch must be followed by test step",
      },
    ]);
  });

  it("requires apply_patch steps to include verification", () => {
    const guard = createGuard([
      "no_unverified_patches",
    ]);

    const result = guard.validateStepOrder([
      {
        action: "apply_patch",
      },
    ]);

    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      {
        type: "patch_verification_required",
        message:
          "Patch operations must include verify flag",
      },
    ]);
  });

  it("accepts a verified patch surrounded by inspection and tests", () => {
    const guard = createGuard([
      "require_inspect_before_edit",
      "require_test_after_edit",
      "no_unverified_patches",
    ]);

    const result = guard.validateStepOrder([
      {
        action: "inspect",
      },
      {
        action: "apply_patch",
        verify: true,
      },
      {
        action: "run_tests",
      },
    ]);

    expect(result).toEqual({
      valid: true,
      violations: [],
    });
  });

  it("ignores rule types it does not recognize", () => {
    const guard = createGuard([
      "future_rule",
    ]);

    const result = guard.validateStepOrder([
      {
        action: "edit",
      },
    ]);

    expect(result).toEqual({
      valid: true,
      violations: [],
    });
  });

  it("does not mistake unrelated action names for test execution", () => {
    const guard = createGuard([
      "require_test_after_edit",
    ]);

    const result = guard.validateStepOrder([
      {
        action: "edit",
      },
      {
        action: "contest_result",
      },
    ]);

    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      {
        type: "test_after_edit",
        index: 0,
        message:
          "Edit or patch must be followed by test step",
      },
    ]);
  });
});
