import { createFinancialSnapshotApplication } from "./createFinancialSnapshotApplication.js";
import { createFinancialSnapshotRepository } from "./createFinancialSnapshotRepository.js";

import {
  FinancialDashboardIntelligenceApplication,
  FinancialExplainabilityApplication,
  FinancialReportingApplication,
} from "../../application/financial";

import { autonomousAuditAgent } from "../../domains/audit/AutonomousAuditAgent.js";
import { FinancialEngine } from "../../domains/ledger/engines/FinancialEngine.js";
import { FinancialDashboardService } from "../../domains/ledger/dashboard/FinancialDashboardService.js";
import { traceExplorerService } from "../../domains/ledger/trace/TraceExplorerService.js";
import { traceQueryService } from "../../domains/ledger/trace/TraceQueryService.js";
import { NetWorthService } from "../../domains/networth";
import { RiskDashboardService } from "../../domains/risk";

export async function createFinancialApplicationSuite(deps = {}) {
  const snapshotRepository =
    deps.snapshotRepository || createFinancialSnapshotRepository();

  const snapshotApplication =
    deps.snapshotApplication ||
    await createFinancialSnapshotApplication({
      snapshotRepository,
    });

  const engine =
    deps.engine ||
    new FinancialEngine({
      generalLedger: deps.generalLedger,
      chartOfAccounts: deps.chartOfAccounts,
    });

  const dashboardService =
    deps.dashboardService || new FinancialDashboardService();

  const reportingApplication =
    deps.reportingApplication ||
    new FinancialReportingApplication({
      engine,
      dashboardService,
    });

  const explainabilityApplication =
    deps.explainabilityApplication ||
    new FinancialExplainabilityApplication({
      traceExplorerService:
        deps.traceExplorerService || traceExplorerService,
      traceQueryService:
        deps.traceQueryService || traceQueryService,
    });

  const dashboardIntelligenceApplication =
    deps.dashboardIntelligenceApplication ||
    new FinancialDashboardIntelligenceApplication({
      auditAgent: deps.auditAgent || autonomousAuditAgent,
      riskDashboardService:
        deps.riskDashboardService || new RiskDashboardService(),
      netWorthService: deps.netWorthService || NetWorthService,
    });

  return {
    snapshotApplication,
    reportingApplication,
    explainabilityApplication,
    dashboardIntelligenceApplication,
    snapshotRepository,
    engine,
    dashboardService,
  };
}
