import { describe, expect, it, vi } from "vitest";
import { VALIDATION_STEP, validatePatch } from "../validatePatch.mjs";

function mockExecFileFn({ failing = [] } = {}) {
  return vi.fn((command, args) => {
    const key = `${command} ${args[0]}`;
    if (failing.includes(key)) {
      const error = new Error(`${key} failed`);
      error.stdout = "some output";
      error.stderr = "some error detail";
      throw error;
    }
    return "ok";
  });
}

const baseArgs = {
  worktreePath: "/fake/worktree", focusedTestPaths: ["src/foo.test.js"], lintPaths: ["src/foo.js"],
};

describe("validatePatch", () => {
  it("passes when every step succeeds", async () => {
    const result = await validatePatch({ ...baseArgs, execFileFn: mockExecFileFn() });
    expect(result.passed).toBe(true);
    expect(result.results.map((r) => r.step).sort()).toEqual([
      VALIDATION_STEP.ACCESSIBILITY_CHECK, VALIDATION_STEP.BUILD, VALIDATION_STEP.FOCUSED_TESTS,
      VALIDATION_STEP.GIT_DIFF_CHECK, VALIDATION_STEP.SCOPED_LINT,
    ].sort());
  });

  // Required test: failed validation
  it("fails overall when focused tests fail, even if every other step passes", async () => {
    const result = await validatePatch({ ...baseArgs, execFileFn: mockExecFileFn({ failing: ["npx vitest"] }) });
    expect(result.passed).toBe(false);
    const testsStep = result.results.find((r) => r.step === VALIDATION_STEP.FOCUSED_TESTS);
    expect(testsStep.passed).toBe(false);
  });

  it("fails overall when scoped lint fails", async () => {
    const result = await validatePatch({ ...baseArgs, execFileFn: mockExecFileFn({ failing: ["npx eslint"] }) });
    expect(result.passed).toBe(false);
  });

  it("fails overall when git diff --check fails (e.g. a whitespace/conflict-marker error)", async () => {
    const result = await validatePatch({ ...baseArgs, execFileFn: mockExecFileFn({ failing: ["git diff"] }) });
    expect(result.passed).toBe(false);
    expect(result.results.find((r) => r.step === VALIDATION_STEP.GIT_DIFF_CHECK).passed).toBe(false);
  });

  it("fails overall when the build fails", async () => {
    const result = await validatePatch({ ...baseArgs, execFileFn: mockExecFileFn({ failing: ["npm run"] }) });
    expect(result.passed).toBe(false);
    expect(result.results.find((r) => r.step === VALIDATION_STEP.BUILD).passed).toBe(false);
  });

  it("fails overall when the accessibility check reports a newly introduced finding", async () => {
    const runAccessibilityCheck = async () => ({ step: VALIDATION_STEP.ACCESSIBILITY_CHECK, passed: false, redacted: true, summary: "1 newly introduced" });
    const result = await validatePatch({ ...baseArgs, execFileFn: mockExecFileFn(), runAccessibilityCheck });
    expect(result.passed).toBe(false);
  });

  it("still runs and records every step even after an earlier one fails -- the full picture is preserved for the audit record", async () => {
    const result = await validatePatch({ ...baseArgs, execFileFn: mockExecFileFn({ failing: ["npx vitest"] }) });
    expect(result.results).toHaveLength(5);
    expect(result.results.every((r) => "step" in r && "passed" in r)).toBe(true);
  });

  it("fails when no focused test paths are provided -- validation cannot pass on an empty check", async () => {
    const result = await validatePatch({ ...baseArgs, focusedTestPaths: [], execFileFn: mockExecFileFn() });
    expect(result.passed).toBe(false);
  });

  it("skips the build step (but still passes it) when runBuild is false", async () => {
    const result = await validatePatch({ ...baseArgs, runBuild: false, execFileFn: mockExecFileFn() });
    const buildStep = result.results.find((r) => r.step === VALIDATION_STEP.BUILD);
    expect(buildStep.passed).toBe(true);
    expect(buildStep.command).toBeNull();
  });

  it("every recorded command is marked redacted -- never a raw, unredacted command captured for the audit trail", async () => {
    const result = await validatePatch({ ...baseArgs, execFileFn: mockExecFileFn() });
    expect(result.results.every((r) => r.redacted === true)).toBe(true);
  });
});
