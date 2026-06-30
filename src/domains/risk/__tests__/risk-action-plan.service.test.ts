import { describe, expect, it } from "vitest";
import {
  RiskActionPlanService,
  type RiskActionPlan,
} from "../risk-action-plan.service";
import type { RiskWatchlistReport } from "../risk-watchlist.service";

const report = (
  watchlistItems: RiskWatchlistReport["watchlistItems"]
): RiskWatchlistReport => ({
  snapshotCount: 3,
  newlyIntroducedRisks: [],
  recurringRisks: [],
  resolvedRisks: [],
  agingRisks: [],
  watchlistItems,
});

describe("RiskActionPlanService", () => {
  it("returns an empty action plan when no watchlist items exist", () => {
    const service = new RiskActionPlanService();

    expect(service.build(report([]))).toEqual<RiskActionPlan>({
      itemCount: 0,
      urgentItemCount: 0,
      highPriorityItemCount: 0,
      items: [],
    });
  });

  it("creates action plan items from executive watchlist items", () => {
    const service = new RiskActionPlanService();

    const actionPlan = service.build(
      report([
        {
          id: "missing-approval",
          status: "recurring",
          severity: "high",
          score: 82,
          persistenceScore: 0.67,
          executiveSummary: "Approval issue persists.",
          recommendedAction: "Require documented approval before payment.",
        },
      ])
    );

    expect(actionPlan.items).toEqual([
      {
        id: "action-missing-approval",
        riskId: "missing-approval",
        priority: "high",
        severity: "high",
        score: 82,
        persistenceScore: 0.67,
        status: "open",
        businessImpact:
          "High risk may create meaningful financial, compliance, or control exposure.",
        action: "Require documented approval before payment.",
        urgency: "Prioritize in the next management review cycle.",
      },
    ]);
  });

  it("assigns urgent priority to critical, high scoring, or highly persistent risks", () => {
    const service = new RiskActionPlanService();

    const actionPlan = service.build(
      report([
        {
          id: "critical-risk",
          status: "recurring",
          severity: "critical",
          score: 75,
          persistenceScore: 0.5,
          executiveSummary: "Critical issue.",
          recommendedAction: "Escalate immediately.",
        },
        {
          id: "high-score-risk",
          status: "new",
          severity: "medium",
          score: 91,
          persistenceScore: 0.25,
          executiveSummary: "High score issue.",
          recommendedAction: "Review immediately.",
        },
        {
          id: "persistent-risk",
          status: "recurring",
          severity: "medium",
          score: 45,
          persistenceScore: 1,
          executiveSummary: "Persistent issue.",
          recommendedAction: "Assign owner.",
        },
      ])
    );

    expect(actionPlan.items.map((item) => item.priority)).toEqual([
      "urgent",
      "urgent",
      "urgent",
    ]);
    expect(actionPlan.urgentItemCount).toBe(3);
  });

  it("counts high priority items separately from urgent items", () => {
    const service = new RiskActionPlanService();

    const actionPlan = service.build(
      report([
        {
          id: "urgent-risk",
          status: "recurring",
          severity: "critical",
          score: 95,
          persistenceScore: 1,
          executiveSummary: "Urgent issue.",
          recommendedAction: "Act now.",
        },
        {
          id: "high-risk",
          status: "new",
          severity: "high",
          score: 72,
          persistenceScore: 0.4,
          executiveSummary: "High issue.",
          recommendedAction: "Review next cycle.",
        },
      ])
    );

    expect(actionPlan.itemCount).toBe(2);
    expect(actionPlan.urgentItemCount).toBe(1);
    expect(actionPlan.highPriorityItemCount).toBe(1);
  });
});
