import { createFinancialSnapshotApplication } from "./createFinancialSnapshotApplication.js";
import { createFinancialSnapshotRepository } from "./createFinancialSnapshotRepository.js";

import {
  FinancialDashboardIntelligenceApplication,
  FinancialExplainabilityApplication,
  FinancialImportApplication,
  FinancialIntelligenceApplication,
  FinancialOperationsApplication,
  FinancialReportingApplication,
  FinancialReadModelApplication,
  FinancialSnapshotViewApplication,
  TransactionReviewApplication,
} from "../../application/financial";

import {
  FinancialForecastService,
  FinancialPlanningService,
  FinancialRecommendationService,
  FinancialScenarioModelingService,
  FinancialTrendAnalysisService,
} from "../../domains/financial-intelligence";

import { DemoFinancialDataProvider } from "../../domains/ledger";

import { FinancialOperationsService } from "../../domains/financial-operations";

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

  const snapshotSuite =
    deps.snapshotSuite ||
    (await createFinancialSnapshotApplication({
      snapshotRepository,
    }));

  const snapshotApplication =
    deps.snapshotApplication || snapshotSuite.snapshotApplication;

  const financialData =
    deps.financialData || new DemoFinancialDataProvider().getFinancialData();

  const engine =
    deps.engine ||
    new FinancialEngine({
      generalLedger: deps.generalLedger || financialData.generalLedger,
      chartOfAccounts: deps.chartOfAccounts || financialData.chartOfAccounts,
    });

  const dashboardService =
    deps.dashboardService || new FinancialDashboardService();

  const reportingApplication =
    deps.reportingApplication ||
    new FinancialReportingApplication({
      engine,
      dashboardService,
    });

  const readModelApplication =
    deps.readModelApplication ||
    new FinancialReadModelApplication({
      reportingApplication,
    });

  const trendAnalysisService =
    deps.trendAnalysisService || new FinancialTrendAnalysisService();

  const scenarioModelingService =
    deps.scenarioModelingService || new FinancialScenarioModelingService();

  const forecastService =
    deps.forecastService || new FinancialForecastService();

  const recommendationService =
    deps.recommendationService || new FinancialRecommendationService();

  const planningService =
    deps.planningService || new FinancialPlanningService();

  const financialIntelligenceApplication =
    deps.financialIntelligenceApplication ||
    new FinancialIntelligenceApplication({
      readModelApplication,
      trendAnalysisService,
      scenarioModelingService,
      forecastService,
      recommendationService,
      planningService,
    });

  const financialOperationsService =
    deps.financialOperationsService || new FinancialOperationsService();

  const financialOperationsApplication =
    deps.financialOperationsApplication ||
    new FinancialOperationsApplication({
      financialIntelligenceApplication,
      financialOperationsService,
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

  const financialSnapshotViewApplication =
    deps.financialSnapshotViewApplication ||
    new FinancialSnapshotViewApplication();

  const financialImportApplication =
    deps.financialImportApplication ||
    new FinancialImportApplication();

  const transactionReviewApplication =
    deps.transactionReviewApplication ||
    new TransactionReviewApplication();

  return {
    snapshotApplication,
    reportingApplication,
    readModelApplication,
    financialIntelligenceApplication,
    financialOperationsApplication,
    financialOperationsService,
    explainabilityApplication,
    dashboardIntelligenceApplication,
    financialSnapshotViewApplication,
    financialImportApplication,
    transactionReviewApplication,
    snapshotRepository,
    engine,
    dashboardService,
  };
}
