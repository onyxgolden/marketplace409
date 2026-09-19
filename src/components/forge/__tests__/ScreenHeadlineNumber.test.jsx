import { describe, expect, it } from "vitest";

import { describeDecisionBacklog } from "@/components/forge/ScreenHeadlineNumber.jsx";

describe("describeDecisionBacklog", () => {
  it("returns a zero state when nothing needs a decision", () => {
    const result = describeDecisionBacklog(0);
    expect(result).toEqual({
      value: "0",
      caption: "Nothing needs a decision. Queue's clear.",
      loaded: true,
    });
  });

  it("uses the singular noun for one transaction", () => {
    const result = describeDecisionBacklog(1);
    expect(result.value).toBe("1");
    expect(result.caption).toContain("1 transaction needs a decision");
    expect(result.loaded).toBe(true);
  });

  it("uses the plural noun for many transactions", () => {
    const result = describeDecisionBacklog(12);
    expect(result.value).toBe("12");
    expect(result.caption).toContain("12 transactions need a decision");
  });

  it("floors fractional counts and clamps negatives to zero", () => {
    expect(describeDecisionBacklog(3.7).value).toBe("3");
    expect(describeDecisionBacklog(-4).value).toBe("0");
  });

  it("accepts numeric strings", () => {
    expect(describeDecisionBacklog("7").value).toBe("7");
  });

  it("never fabricates a zero for missing input -- the header shows a dash", () => {
    for (const missing of [null, undefined, NaN, "abc", {}]) {
      const result = describeDecisionBacklog(missing);
      expect(result.value).toBe("–");
      expect(result.caption).toBeNull();
      expect(result.loaded).toBe(false);
    }
  });
});
