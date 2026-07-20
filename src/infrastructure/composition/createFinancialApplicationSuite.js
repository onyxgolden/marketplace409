import { createFinancialSnapshotApplication } from "./createFinancialSnapshotApplication.js";
import { createFinancialSnapshotRepository } from "./createFinancialSnapshotRepository.js";
import { createFinancialEventRepository } from "./createFinancialEventRepository.js";

import { DecisionApplication } from "../../application/decision";

import {
  FinancialDashboardIntelligenceApplication,
  FinancialDecisionApplication,
  FinancialDecisionOperationsApplication,
  FinancialExplainabilityApplication,
  FinancialImportApplication,
  FinancialIntelligenceApplication,
  FinancialOperationsApplication,
  FinancialReportingApplication,
  FinancialReadModelApplication,
  FinancialWorkspaceQueryService,
  FinancialSnapshotViewApplication,
  TransactionReviewApplication,
} from "../../application/financial";

import {
  financialWorkspaceReadModelAdapter,
} from "../../application/financial/read-models/FinancialWorkspaceReadModelAdapter.js";

import {
  financialPositionReadModelAdapter,
} from "../../application/financial/read-models/FinancialPositionReadModelAdapter.js";

import {
  FinancialForecastService,
  FinancialPlanningService,
  FinancialRecommendationService,
  FinancialScenarioModelingService,
  FinancialTrendAnalysisService,
} from "../../domains/financial-intelligence";

import {
  financialEventAggregationService,
} from "../../domains/financial-workspace";

import {
  FinancialPositionQueryService,
} from "../../domains/financial-position";

import { DemoFinancialDataProvider } from "../../domains/ledger";

import { FinancialOperationsService } from "../../domains/financial-operations";

import { autonomousAuditAgent } from "../../domains/audit/AutonomousAuditAgent.js";
import { FinancialEngine } from "../../domains/ledger/engines/FinancialEngine.js";
import { FinancialDashboardService } from "../../domains/ledger/dashboard/FinancialDashboardService.js";
import { traceExplorerService } from "../../domains/ledger/trace/TraceExplorerService.js";
import { traceQueryService } from "../../domains/ledger/trace/TraceQueryService.js";
import { NetWorthService } from "../../domains/networth";
import { RiskDashboardService } from "../../domains/risk";

function createLazyAssetRepository() {
  return Object.freeze({
    async getAll() {
      const { AssetRepository } =
        await import("../../domains/asset");

      return AssetRepository.getAll();
    },
  });
}

function createLazyLiabilityRepository() {
  return Object.freeze({
    async getAll() {
      const { LiabilityRepository } =
        await import("../../domains/liability");

      return LiabilityRepository.getAll();
    },
  });
}

export async function createFinancialApplicationSuite(deps = {}) {
  const snapshotRepository =
    deps.snapshotRepository || createFinancialSnapshotRepository();

  const financialEventRepository =
    deps.financialEventRepository ||
    (await createFinancialEventRepository());

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

  const financialWorkspaceQueryService =
    deps.financialWorkspaceQueryService ||
    new FinancialWorkspaceQueryService({
      financialEventRepository,
      aggregationService:
        deps.aggregationService ||
        financialEventAggregationService,
    });

  const readModelAdapter =
    deps.financialWorkspaceReadModelAdapter ||
    financialWorkspaceReadModelAdapter;

  const assetRepository =
    deps.assetRepository ||
    createLazyAssetRepository();

  const liabilityRepository =
    deps.liabilityRepository ||
    createLazyLiabilityRepository();

  const financialPositionQueryService =
    deps.financialPositionQueryService ||
    new FinancialPositionQueryService({
      assetRepository,
      liabilityRepository,
      netWorthService:
        deps.positionNetWorthService || NetWorthService,
    });

  const positionReadModelAdapter =
    deps.financialPositionReadModelAdapter ||
    financialPositionReadModelAdapter;

  const readModelApplication =
    deps.readModelApplication ||
    new FinancialReadModelApplication({
      financialWorkspaceQueryService,
      readModelAdapter,
      financialPositionQueryService,
      financialPositionReadModelAdapter:
        positionReadModelAdapter,
      currentOwnerId: deps.currentOwnerId,
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

  const decisionApplication =
    deps.decisionApplication ||
    new DecisionApplication();

  const financialDecisionApplication =
    deps.financialDecisionApplication ||
    new FinancialDecisionApplication({
      financialIntelligenceApplication,
      decisionApplication,
    });

  const financialOperationsService =
    deps.financialOperationsService || new FinancialOperationsService();

  const financialOperationsApplication =
    deps.financialOperationsApplication ||
    new FinancialOperationsApplication({
      financialIntelligenceApplication,
      financialOperationsService,
    });

  const financialDecisionOperationsApplication =
    deps.financialDecisionOperationsApplication ||
    new FinancialDecisionOperationsApplication({
      financialOperationsApplication,
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
    new FinancialImportApplication({
      financialEventRepository,
    });

  const transactionReviewApplication =
    deps.transactionReviewApplication ||
    new TransactionReviewApplication();

  return {
    snapshotApplication,
    reportingApplication,
    readModelApplication,
    financialWorkspaceQueryService,
    financialWorkspaceReadModelAdapter: readModelAdapter,
    financialPositionQueryService,
    financialPositionReadModelAdapter:
      positionReadModelAdapter,
    assetRepository,
    liabilityRepository,
    financialIntelligenceApplication,
    financialDecisionApplication,
    financialOperationsApplication,
    financialDecisionOperationsApplication,
    financialOperationsService,
    explainabilityApplication,
    dashboardIntelligenceApplication,
    financialSnapshotViewApplication,
    financialImportApplication,
    transactionReviewApplication,
    snapshotRepository,
    financialEventRepository,
    engine,
    dashboardService,
  };
}
