import { describe, expect, it } from "vitest";
import deriveRetirementMilestones from "../deriveRetirementMilestones";

const BASE = {
  currentAge: 40,
  retirementAge: 65,
  planningAge: 95,
  ssClaimAge: 67,
  monthlySSBenefit: 2000,
  mortgagePayoffAge: 60,
};

describe("deriveRetirementMilestones", () => {
  it("derives every milestone, sorted by age", () => {
    const milestones = deriveRetirementMilestones(BASE);
    expect(milestones.map((milestone) => milestone.key)).toEqual([
      "mortgage",
      "retire",
      "medicare",
      "social-security",
      "planning",
    ]);
    expect(milestones.map((milestone) => milestone.age)).toEqual([60, 65, 65, 67, 95]);
    expect(milestones[0].label).toBe("Mortgage paid off at 60");
    expect(milestones[3].label).toBe("Claim Social Security at 67");
  });

  it("omits Social Security and mortgage milestones when the user entered nothing", () => {
    const milestones = deriveRetirementMilestones({
      ...BASE,
      monthlySSBenefit: 0,
      mortgagePayoffAge: null,
    });
    expect(milestones.map((milestone) => milestone.key)).toEqual(["retire", "medicare", "planning"]);
  });

  it("drops milestones outside the [currentAge, planningAge] window", () => {
    const milestones = deriveRetirementMilestones({
      ...BASE,
      currentAge: 62,
      mortgagePayoffAge: 100, // past the planning horizon
      ssClaimAge: 60, // before the window starts
    });
    expect(milestones.find((milestone) => milestone.key === "mortgage")).toBeUndefined();
    expect(milestones.find((milestone) => milestone.key === "social-security")).toBeUndefined();
    expect(milestones.find((milestone) => milestone.key === "medicare")).toBeDefined();
  });

  it("omits Medicare when 65 is outside the window", () => {
    const milestones = deriveRetirementMilestones({ ...BASE, currentAge: 70 });
    expect(milestones.find((milestone) => milestone.key === "medicare")).toBeUndefined();
  });

  it("returns an empty array on invalid ages", () => {
    expect(deriveRetirementMilestones({ ...BASE, currentAge: NaN })).toEqual([]);
    expect(
      deriveRetirementMilestones({ ...BASE, currentAge: 95, planningAge: 90 }),
    ).toEqual([]);
  });
});
