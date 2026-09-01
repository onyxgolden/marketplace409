import { describe, expect, it } from "vitest";
import { accessibilityCheckStepFromComparison, comparePatchFindings } from "../capturePatchPreview.mjs";

function finding(overrides = {}) {
  return { category: "undersized_touch_target", routeId: "home", viewport: "mobile", affectedComponent: "button#tiny", ...overrides };
}

describe("comparePatchFindings", () => {
  it("reports a finding as resolved when it existed before and not after", () => {
    const result = comparePatchFindings([finding()], []);
    expect(result.resolved).toHaveLength(1);
    expect(result.newlyIntroduced).toHaveLength(0);
    expect(result.stillPresent).toHaveLength(0);
  });

  it("reports a finding as newly introduced when it exists after but not before", () => {
    const result = comparePatchFindings([], [finding()]);
    expect(result.newlyIntroduced).toHaveLength(1);
    expect(result.resolved).toHaveLength(0);
  });

  it("reports a finding as still present when it exists on both sides with the same identity", () => {
    const result = comparePatchFindings([finding()], [finding()]);
    expect(result.stillPresent).toHaveLength(1);
    expect(result.resolved).toHaveLength(0);
    expect(result.newlyIntroduced).toHaveLength(0);
  });

  it("distinguishes findings by category+route+viewport+component, not by findingId", () => {
    const before = [{ ...finding(), findingId: "finding_before_id" }];
    const after = [{ ...finding(), findingId: "finding_after_id" }]; // different id, same identity
    const result = comparePatchFindings(before, after);
    expect(result.stillPresent).toHaveLength(1);
  });

  it("treats a finding at a different viewport as a distinct finding", () => {
    const result = comparePatchFindings([finding({ viewport: "mobile" })], [finding({ viewport: "desktop" })]);
    expect(result.resolved).toHaveLength(1);
    expect(result.newlyIntroduced).toHaveLength(1);
  });

  it("handles an empty before and after cleanly", () => {
    const result = comparePatchFindings([], []);
    expect(result).toEqual({ resolved: [], newlyIntroduced: [], stillPresent: [] });
  });
});

describe("accessibilityCheckStepFromComparison", () => {
  it("passes when nothing new was introduced, even if some findings are still present", () => {
    const comparison = comparePatchFindings([finding()], [finding()]);
    expect(accessibilityCheckStepFromComparison(comparison).passed).toBe(true);
  });

  it("passes when findings were resolved and nothing new appeared", () => {
    const comparison = comparePatchFindings([finding()], []);
    expect(accessibilityCheckStepFromComparison(comparison).passed).toBe(true);
  });

  // Required test: failed validation (accessibility-specific case)
  it("fails when the patch introduces even one new finding, regardless of what else it fixed", () => {
    const comparison = comparePatchFindings([finding({ category: "unreadable_contrast" })], [finding({ category: "missing_accessible_name" })]);
    expect(accessibilityCheckStepFromComparison(comparison).passed).toBe(false);
  });

  it("summarizes the resolved/newly-introduced/still-present counts", () => {
    const comparison = { resolved: [finding()], newlyIntroduced: [], stillPresent: [finding(), finding()] };
    expect(accessibilityCheckStepFromComparison(comparison).summary).toBe("1 resolved, 0 newly introduced, 2 still present");
  });
});
