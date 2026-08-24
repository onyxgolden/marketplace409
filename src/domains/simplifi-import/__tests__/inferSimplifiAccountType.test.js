import { describe, expect, it } from "vitest";
import { inferSimplifiAccountType } from "../inferSimplifiAccountType";

describe("inferSimplifiAccountType", () => {
  it.each([
    ["Dugood Personal Ck", "depository"],
    ["Business Savings", "depository"],
    ["Chase Credit Card", "credit"],
    ["Rave Line of credit", "loan"],
    ["Jason's retirement fund", "investment"],
    ["XRP", "investment"],
    ["335 Butler", "other"],
  ])("classifies %s as %s", (name, expected) => {
    expect(inferSimplifiAccountType(name)).toBe(expected);
  });
});
