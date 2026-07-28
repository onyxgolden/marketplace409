import { createFinancialSnapshotApplication } from "./createFinancialSnapshotApplication.js";
import { createFinancialSnapshotRepository } from "./createFinancialSnapshotRepository.js";
import { createFinancialEventRepository } from "./createFinancialEventRepository.js";
import { createDecisionOutcomeRepository } from "./createDecisionOutcomeRepository.js";

import {
  createLazyFinancialAccountRepository,
  FinancialAccountRepositoryStorage,
} from "./createFinancialAccountRepository.js";

import {
  AccountBalanceRepositoryStorage,
  createLazyAccountBalanceRepository,
} from "./createAccountBalanceRepository.js";

import { DecisionApplication } from "../../application/decision";
import { DecisionOutcomeEvaluator } from "../../domains/decision";

import {
  FinancialDashboardIntelligenceApplication,
  FinancialDecisionApplication,
  FinancialDecisionOperationsApplication,
  FinancialDecisionOutcomeApplication,
  FinancialExplainabilityApplication,
  FinancialImportApplication,
  ForgeDashboardApplication,
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
  DecisionOutcomeReadModelAdapter,
} from "../../application/financial/read-models/DecisionOutcomeReadModelAdapter.js";

import {
  DecisionOutcomeQueryService,
} from "../../application/financial/read-models/DecisionOutcomeQueryService.js";

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

import {
  InMemoryFinancialAccountRepository,
} from "../../domains/financial-account";

import {
  InMemoryAccountBalanceRepository,
} from "../../domains/account-balance";

import { DemoFinancialDataProvider } from "../../domains/ledger";

import { FinancialOperationsService } from "../../domains/financial-operations";

import { autonomousAuditAgent } from "../../domains/audit/AutonomousAuditAgent.js";
import { FinancialEngine } from "../../domains/ledger/engines/FinancialEngine.js";

import {
  CanonicalExplainabilityProjection,
} from "../../application/intelligence";
import { FinancialDashboardService } from "../../domains/ledger/dashboard/FinancialDashboardService.js";
import { traceExplorerService } from "../../domains/ledger/trace/TraceExplorerService.js";
import { traceQueryService } from "../../domains/ledger/trace/TraceQueryService.js";
import { NetWorthService } from "../../domains/networth";
import { RiskDashboardService } from "../../domains/risk";

export async function createFinancialApplicationSuite(deps = {}) {
  const snapshotRepository =
    deps.snapshotRepository || createFinancialSnapshotRepository();

  const financialEventRepository =
    deps.financialEventRepository ||
    (await createFinancialEventRepository({
      supabaseClient: deps.supabaseClient,
    }));

  const decisionOutcomeRepository =
    deps.decisionOutcomeRepository ||
    (await createDecisionOutcomeRepository({
      supabaseClient: deps.supabaseClient,
      ownerId: deps.ownerId,
    }));

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

  const financialAccountRepositoryStorage =
    deps.financialAccountRepositoryStorage ||
    process.env.FINANCIAL_ACCOUNT_REPOSITORY ||
    FinancialAccountRepositoryStorage.MEMORY;

  const financialAccountRepository =
    deps.financialAccountRepository ||
    (
      financialAccountRepositoryStorage ===
      FinancialAccountRepositoryStorage.SUPABASE
        ? createLazyFinancialAccountRepository({
            storage:
              FinancialAccountRepositoryStorage.SUPABASE,
            supabaseClient:
              deps.supabaseClient,
          })
        : new InMemoryFinancialAccountRepository()
    );

  const accountBalanceRepositoryStorage =
    deps.accountBalanceRepositoryStorage ||
    process.env.ACCOUNT_BALANCE_REPOSITORY ||
    AccountBalanceRepositoryStorage.MEMORY;

  const accountBalanceRepository =
    deps.accountBalanceRepository ||
    (
      accountBalanceRepositoryStorage ===
      AccountBalanceRepositoryStorage.SUPABASE
        ? createLazyAccountBalanceRepository({
            storage:
              AccountBalanceRepositoryStorage.SUPABASE,
            supabaseClient:
              deps.supabaseClient,
          })
        : new InMemoryAccountBalanceRepository()
    );

  const financialPositionQueryService =
    deps.financialPositionQueryService ||
    new FinancialPositionQueryService({
      financialAccountRepository,
      accountBalanceRepository,
      netWorthService:
        deps.positionNetWorthService || NetWorthService,
    });

  const positionReadModelAdapter =
    deps.financialPositionReadModelAdapter ||
    financialPositionReadModelAdapter;

  const decisionOutcomeQueryService =
    deps.decisionOutcomeQueryService ||
    new DecisionOutcomeQueryService({
      decisionOutcomeRepository,
    });

  const decisionOutcomeReadModelAdapter =
    deps.decisionOutcomeReadModelAdapter ||
    new DecisionOutcomeReadModelAdapter();

  const readModelApplication =
    deps.readModelApplication ||
    new FinancialReadModelApplication({
      financialWorkspaceQueryService,
      readModelAdapter,
      financialPositionQueryService,
      financialPositionReadModelAdapter:
        positionReadModelAdapter,
      decisionOutcomeQueryService,
      decisionOutcomeReadModelAdapter,
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

  const decisionOutcomeEvaluator =
    deps.decisionOutcomeEvaluator ||
    new DecisionOutcomeEvaluator();

  const financialDecisionOutcomeApplication =
    deps.financialDecisionOutcomeApplication ||
    new FinancialDecisionOutcomeApplication({
      decisionOutcomeEvaluator,
      decisionOutcomeRepository,
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

  const canonicalExplainabilityProjection =
    deps.canonicalExplainabilityProjection ||
    CanonicalExplainabilityProjection;

  const explainabilityApplication =
    deps.explainabilityApplication ||
    new FinancialExplainabilityApplication({
      traceExplorerService:
        deps.traceExplorerService || traceExplorerService,
      traceQueryService:
        deps.traceQueryService || traceQueryService,
      canonicalExplainabilityProjection,
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
    decisionOutcomeRepository,
    decisionOutcomeQueryService,
    decisionOutcomeReadModelAdapter,
    financialAccountRepository,
    accountBalanceRepository,
    financialIntelligenceApplication,
    financialDecisionApplication,
    financialDecisionOutcomeApplication,
    financialOperationsApplication,
    financialDecisionOperationsApplication,
    financialOperationsService,
    explainabilityApplication,
    canonicalExplainabilityProjection,
    dashboardIntelligenceApplication,
    financialSnapshotViewApplication,
    financialImportApplication,
    transactionReviewApplication,
    forgeDashboardApplication:
      ForgeDashboardApplication,
    snapshotRepository,
    financialEventRepository,
    engine,
    dashboardService,
  };
}
