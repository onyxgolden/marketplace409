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
  TransactionReviewQueryService,
  transactionReviewReadModelAdapter,
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
      // Forward the same real financial data this suite was given, if any, so a future caller
      // that configures a real provider gets a consistent, non-demo snapshotApplication too --
      // not just a non-demo top-level engine/reportingApplication. See
      // createFinancialSnapshotApplication.js for why it defaults to null, not demo data, on its
      // own when nothing is forwarded here.
      financialData: deps.financialData,
    }));

  const snapshotApplication =
    deps.snapshotApplication || snapshotSuite.snapshotApplication;

  // financialData is NEVER implicitly demo-backed here. An authenticated production caller
  // (createAuthenticatedFinancialApplication.js) never passes deps.financialData, so engine and
  // reportingApplication below resolve to null rather than silently reporting fabricated numbers
  // as though they belonged to the authenticated user. DemoFinancialDataProvider remains available
  // for any caller (test, Storybook/preview, fixture) that explicitly injects deps.financialData --
  // see DemoFinancialDataProvider itself for that intended use. Do not reintroduce an implicit
  // `deps.financialData || new DemoFinancialDataProvider()...` fallback here.
  const financialData = deps.financialData || null;

  const hasRealLedgerInputs =
    Boolean(deps.generalLedger && deps.chartOfAccounts) || Boolean(financialData);

  const engine =
    deps.engine ||
    (hasRealLedgerInputs
      ? new FinancialEngine({
          generalLedger: deps.generalLedger || financialData.generalLedger,
          chartOfAccounts: deps.chartOfAccounts || financialData.chartOfAccounts,
        })
      : null);

  const dashboardService =
    deps.dashboardService || new FinancialDashboardService();

  // null, not a demo-backed instance, when no real ledger input was configured -- callers (e.g.
  // /api/financial/reports) must treat a null reportingApplication as "financial data
  // unavailable," never call into it and risk it being demo data, and never treat null as $0.
  const reportingApplication =
    deps.reportingApplication ||
    (engine
      ? new FinancialReportingApplication({
          engine,
          dashboardService,
        })
      : null);

  // Reads financial_account_groups/financial_account_group_members under has_workspace_access
  // RLS -- deps.supabaseClient here is always the caller's own authenticated (cookie-bound)
  // client (see createAuthenticatedFinancialApplication.js), never a service-role one, exactly
  // like financialAccountRepository/accountBalanceRepository above already require. Dynamically
  // imported, not a static top-level import: SupabaseFinancialAccountGroupRepository.js pulls in
  // @/lib/supabase's module-scope BROWSER client construction, which throws in any test/server
  // environment without NEXT_PUBLIC_SUPABASE_URL configured -- the exact reason every OTHER
  // Supabase-backed repository in this same file is also behind a dynamic import (see
  // createFinancialAccountRepository.js's own createLazyFinancialAccountRepository). No
  // in-memory fallback exists for this brand-new, RLS/RPC-only feature: with no real
  // supabaseClient, financialAccountGroupRepository is simply null, and both
  // FinancialPositionQueryService/FinancialWorkspaceQueryService already treat that as "no
  // groups exist" -- correct behavior, not a workaround.
  let financialAccountGroupRepository = deps.financialAccountGroupRepository || null;
  if (!financialAccountGroupRepository && deps.supabaseClient) {
    const { SupabaseFinancialAccountGroupRepository } = await import(
      "../../domains/financial-account-group/SupabaseFinancialAccountGroupRepository.js"
    );
    financialAccountGroupRepository = new SupabaseFinancialAccountGroupRepository({
      supabaseClient: deps.supabaseClient,
    });
  }

  // Backs FinancialPositionQueryService's connection-health gating on balance authority (a
  // disconnected/needs_attention/error connection must never win balance authority just because
  // its last-known balance snapshot looks recent -- see LIVE_CONNECTION_ELIGIBLE_STATUSES there).
  // Reads the connections table under has_workspace_access RLS, DB-only, no Stripe/Plaid call.
  // Same dynamic-import rationale as financialAccountGroupRepository above (consistency, even
  // though SupabaseConnectionRepository.js itself has no eager top-level Supabase import). No
  // real supabaseClient -> connectionRepository stays null -> FinancialPositionQueryService
  // already treats that as "skip health gating," matching its pre-existing behavior exactly.
  let connectionRepository = deps.connectionRepository || null;
  if (!connectionRepository && deps.supabaseClient) {
    const { SupabaseConnectionRepository } = await import(
      "../../domains/connection/SupabaseConnectionRepository.js"
    );
    connectionRepository = new SupabaseConnectionRepository({
      supabaseClient: deps.supabaseClient,
    });
  }

  const financialWorkspaceQueryService =
    deps.financialWorkspaceQueryService ||
    new FinancialWorkspaceQueryService({
      financialEventRepository,
      aggregationService:
        deps.aggregationService ||
        financialEventAggregationService,
      financialAccountGroupRepository,
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
      financialAccountGroupRepository,
      connectionRepository,
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

  const transactionReviewQueryService =
    deps.transactionReviewQueryService ||
    (
      deps.transactionReviewProjectionService
        ? new TransactionReviewQueryService({
            financialEventRepository,
            projectionService:
              deps.transactionReviewProjectionService,
          })
        : null
    );

  const transactionReviewReadModel =
    deps.transactionReviewReadModelAdapter ||
    transactionReviewReadModelAdapter;

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
    financialAccountGroupRepository,
    connectionRepository,
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
    transactionReviewQueryService,
    transactionReviewReadModelAdapter:
      transactionReviewReadModel,
    transactionReviewApplication,
    forgeDashboardApplication:
      ForgeDashboardApplication,
    snapshotRepository,
    financialEventRepository,
    engine,
    dashboardService,
  };
}
