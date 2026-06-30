import type {
  ExecutiveRiskWatchlistItem,
  RiskWatchlistReport,
} from "./risk-watchlist.service";
import type { RiskSeverity } from "./risk.types";

export type RiskActionPlanPriority = "low" | "medium" | "high" | "urgent";

export type RiskActionPlanStatus = "open";

export type RiskActionPlanItem = {
  id: string;
  riskId: string;
  priority: RiskActionPlanPriority;
  severity: RiskSeverity;
  score: number;
  persistenceScore: number;
  status: RiskActionPlanStatus;
  businessImpact: string;
  action: string;
  urgency: string;
};

export type RiskActionPlan = {
  itemCount: number;
  urgentItemCount: number;
  highPriorityItemCount: number;
  items: RiskActionPlanItem[];
};

export class RiskActionPlanService {
  build(report: RiskWatchlistReport): RiskActionPlan {
    const items = report.watchlistItems.map((item) =>
      this.toActionPlanItem(item)
    );

    return {
      itemCount: items.length,
      urgentItemCount: items.filter((item) => item.priority === "urgent")
        .length,
      highPriorityItemCount: items.filter((item) => item.priority === "high")
        .length,
      items,
    };
  }

  private toActionPlanItem(
    item: ExecutiveRiskWatchlistItem
  ): RiskActionPlanItem {
    const priority = this.assignPriority(item);

    return {
      id: `action-${item.id}`,
      riskId: item.id,
      priority,
      severity: item.severity,
      score: item.score,
      persistenceScore: item.persistenceScore,
      status: "open",
      businessImpact: this.describeBusinessImpact(item),
      action: item.recommendedAction,
      urgency: this.describeUrgency(priority),
    };
  }

  private assignPriority(
    item: ExecutiveRiskWatchlistItem
  ): RiskActionPlanPriority {
    if (
      item.severity === "critical" ||
      item.score >= 90 ||
      item.persistenceScore >= 0.9
    ) {
      return "urgent";
    }

    if (
      item.severity === "high" ||
      item.score >= 70 ||
      item.persistenceScore >= 0.6
    ) {
      return "high";
    }

    if (
      item.severity === "medium" ||
      item.score >= 40 ||
      item.persistenceScore >= 0.3
    ) {
      return "medium";
    }

    return "low";
  }

  private describeBusinessImpact(item: ExecutiveRiskWatchlistItem): string {
    if (item.severity === "critical") {
      return "Critical risk may materially impact financial integrity, governance, or operational trust.";
    }

    if (item.severity === "high") {
      return "High risk may create meaningful financial, compliance, or control exposure.";
    }

    if (item.severity === "medium") {
      return "Medium risk should be addressed before it becomes a recurring control weakness.";
    }

    return "Low risk should be monitored and resolved through normal operating discipline.";
  }

  private describeUrgency(priority: RiskActionPlanPriority): string {
    if (priority === "urgent") {
      return "Immediate management attention required.";
    }

    if (priority === "high") {
      return "Prioritize in the next management review cycle.";
    }

    if (priority === "medium") {
      return "Schedule follow-up and assign accountability.";
    }

    return "Track and close through routine controls.";
  }
}
