import type { RiskAssessment } from "./risk-intelligence.service";
import type { RiskTrend } from "./risk-history.service";

export type ExecutiveBriefing = {
  headline: string;
  overview: string;
  improvements: string[];
  concerns: string[];
  priorities: string[];
  recommendedActions: string[];
  outlook: string;
};

export class ExecutiveBriefingService {
  brief({
    assessment,
    trend,
  }: {
    assessment: RiskAssessment;
    trend: RiskTrend;
  }): ExecutiveBriefing {
    return {
      headline: this.headlineFor(trend),
      overview: assessment.summary,
      improvements: this.improvementsFor(trend),
      concerns: this.concernsFor({ assessment, trend }),
      priorities: this.prioritiesFor(assessment),
      recommendedActions: [...assessment.recommendations],
      outlook: this.outlookFor(trend),
    };
  }

  private headlineFor(trend: RiskTrend): string {
    if (trend.previousScore === null) {
      return `Initial executive risk baseline is ${trend.currentSeverity}.`;
    }

    if (trend.direction === "worsening") {
      return `Urgent review recommended: risk worsened by ${trend.scoreChange} point(s).`;
    }

    if (trend.direction === "improving") {
      return `Risk posture is improving by ${Math.abs(trend.scoreChange)} point(s).`;
    }

    return `Risk posture is stable at ${trend.currentSeverity}.`;
  }

  private improvementsFor(trend: RiskTrend): string[] {
    if (trend.previousScore === null) {
      return ["Initial baseline established for future executive comparison."];
    }

    if (trend.direction === "improving") {
      return [
        `Overall risk score improved from ${trend.previousScore} to ${trend.currentScore}.`,
      ];
    }

    if (trend.direction === "stable") {
      return ["Risk posture remained stable compared with the previous snapshot."];
    }

    return [];
  }

  private concernsFor({
    assessment,
    trend,
  }: {
    assessment: RiskAssessment;
    trend: RiskTrend;
  }): string[] {
    const concerns: string[] = [];

    if (trend.direction === "worsening") {
      concerns.push(
        `Overall risk score increased from ${trend.previousScore} to ${trend.currentScore}.`
      );
    }

    for (const driver of assessment.primaryDrivers) {
      if (driver.severity === "high" || driver.severity === "critical") {
        concerns.push(driver.explanation);
      }
    }

    return [...new Set(concerns)];
  }

  private prioritiesFor(assessment: RiskAssessment): string[] {
    return assessment.primaryDrivers.map((driver) => driver.explanation);
  }

  private outlookFor(trend: RiskTrend): string {
    if (trend.previousScore === null) {
      return "This is the first executive baseline; future snapshots will show whether risk is improving, worsening, or stable.";
    }

    if (trend.direction === "worsening") {
      return "Outlook is negative until the primary drivers are reviewed and corrective actions are completed.";
    }

    if (trend.direction === "improving") {
      return "Outlook is positive if current controls continue and remaining drivers are monitored.";
    }

    return "Outlook is steady; continue monitoring for material changes.";
  }
}
