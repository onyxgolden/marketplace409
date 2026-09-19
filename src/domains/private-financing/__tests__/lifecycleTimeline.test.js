import { describe, expect, it } from "vitest";
import { buildFinancingLifecycleSteps } from "../lifecycleTimeline";

describe("buildFinancingLifecycleSteps", () => {
  it("shows originated then servicing for an active account", () => {
    const steps = buildFinancingLifecycleSteps({ status: "active", openedDate: "2026-01-15" });
    expect(steps.map(step => [step.label, step.state])).toEqual([
      ["Originated", "complete"],
      ["Servicing", "current"],
    ]);
    expect(steps[0].detail).toBe("Jan 15, 2026");
  });

  it("completes the chain for a paid-off account", () => {
    const steps = buildFinancingLifecycleSteps({ status: "paid_off", openedDate: "2025-06-01" });
    expect(steps.map(step => [step.label, step.state])).toEqual([
      ["Originated", "complete"],
      ["Servicing", "complete"],
      ["Paid off", "complete"],
    ]);
  });

  it("ends written-off and cancelled accounts with a failed terminal step", () => {
    expect(buildFinancingLifecycleSteps({ status: "written_off" }).at(-1)).toEqual({ label: "Written off", state: "failed" });
    expect(buildFinancingLifecycleSteps({ status: "cancelled" }).at(-1)).toEqual({ label: "Cancelled", state: "failed" });
  });

  it("never invents application stages that do not exist in the data", () => {
    const steps = buildFinancingLifecycleSteps({ status: "active" });
    expect(steps.flatMap(step => [step.label])).not.toContain("Applied");
    expect(steps.flatMap(step => [step.label])).not.toContain("Funded");
  });

  it("shows an unrecognized status raw instead of force-fitting the chain", () => {
    const steps = buildFinancingLifecycleSteps({ status: "delinquent_review" });
    expect(steps).toHaveLength(1);
    expect(steps[0].label).toContain("delinquent review");
    expect(steps[0].state).toBe("current");
  });
});
