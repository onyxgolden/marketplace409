import {
  ExecutiveBriefingService,
  type ExecutiveBriefing,
} from "./executive-briefing.service";
import {
  RiskHistoryService,
  type RiskSnapshot,
  type RiskTrend,
} from "./risk-history.service";
import {
  RiskIntelligenceService,
  type RiskAssessment,
} from "./risk-intelligence.service";
import { RiskEngine } from "./risk-engine.service";
import type { OverallRiskSummary, RiskFinding } from "./risk.types";

type AuditFinding = {
  accountId?: string;
  type?: string;
  explanation?: string;
  traceSummary?: string;
};

export type RiskDashboard = {
  summary: OverallRiskSummary;
  assessment: RiskAssessment;
  snapshot: RiskSnapshot;
  trend: RiskTrend;
  executiveBriefing: ExecutiveBriefing;
  topRisks: RiskFinding[];
};

export class RiskDashboardService {
  private readonly engine: RiskEngine;
  private readonly intelligence: RiskIntelligenceService;
  private readonly history: RiskHistoryService;
  private readonly briefing: ExecutiveBriefingService;

  constructor({
    engine = new RiskEngine(),
    intelligence = new RiskIntelligenceService(),
    history = new RiskHistoryService(),
    briefing = new ExecutiveBriefingService(),
  }: {
    engine?: RiskEngine;
    intelligence?: RiskIntelligenceService;
    history?: RiskHistoryService;
    briefing?: ExecutiveBriefingService;
  } = {}) {
    this.engine = engine;
    this.intelligence = intelligence;
    this.history = history;
    this.briefing = briefing;
  }

  build({
    auditFindings = [],
    previousSnapshot = null,
    timestamp,
  }: {
    auditFindings?: AuditFinding[];
    previousSnapshot?: RiskSnapshot | null;
    timestamp?: string;
  } = {}): RiskDashboard {
    const summary = this.engine.analyze(auditFindings);
    const assessment = this.intelligence.assess(summary);
    const snapshot = this.history.createSnapshot({ summary, timestamp });
    const trend = this.history.compare(snapshot, previousSnapshot);
    const executiveBriefing = this.briefing.brief({ assessment, trend });

    return {
      summary,
      assessment,
      snapshot,
      trend,
      executiveBriefing,
      topRisks: summary.topRisks,
    };
  }
}
