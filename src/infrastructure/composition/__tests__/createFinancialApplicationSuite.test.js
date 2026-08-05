import { createFinancialApplicationSuite } from "../createFinancialApplicationSuite.js";
import {
  FinancialDashboardIntelligenceApplication,
  FinancialDecisionApplication,
  FinancialDecisionOperationsApplication,
  FinancialDecisionOutcomeApplication,
  FinancialExplainabilityApplication,
  FinancialImportApplication,
  FinancialIntelligenceApplication,
  FinancialOperationsApplication,
  FinancialReadModelApplication,
  FinancialSnapshotViewApplication,
  TransactionReviewApplication,
  TransactionReviewQueryService,
  transactionReviewReadModelAdapter,
} from "../../../application/financial";

import { FinancialOperationsService } from "../../../domains/financial-operations";
import {
  DecisionOutcomeReadModelAdapter,
} from "../../../application/financial/read-models/DecisionOutcomeReadModelAdapter.js";
import {
  DecisionOutcomeQueryService,
} from "../../../application/financial/read-models/DecisionOutcomeQueryService.js";
import {
  InMemoryDecisionOutcomeRepository,
} from "../../../domains/decision/InMemoryDecisionOutcomeRepository.js";

describe("createFinancialApplicationSuite", () => {
  test("wires financial explainability application into the suite", async () => {
    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
    });

    expect(suite.explainabilityApplication).toBeInstanceOf(
      FinancialExplainabilityApplication,
    );
  });

  test("allows explainability application injection", async () => {
    const explainabilityApplication = {};

    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
      explainabilityApplication,
    });

    expect(suite.explainabilityApplication).toBe(
      explainabilityApplication,
    );
  });

  test("wires dashboard intelligence application into the suite", async () => {
    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
    });

    expect(suite.dashboardIntelligenceApplication).toBeInstanceOf(
      FinancialDashboardIntelligenceApplication,
    );
  });

  test("allows dashboard intelligence application injection", async () => {
    const dashboardIntelligenceApplication = {};

    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
      dashboardIntelligenceApplication,
    });

    expect(suite.dashboardIntelligenceApplication).toBe(
      dashboardIntelligenceApplication,
    );
  });

  test("wires repository-backed financial read models into the suite", async () => {
    const financialWorkspaceQueryService = {
      buildWorkspace: vi.fn(),
    };

    const financialWorkspaceReadModelAdapter = {
      buildDashboard: vi.fn(),
      buildReports: vi.fn(),
    };

    const currentOwnerId = vi.fn(async () => "owner-1");

    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
      financialWorkspaceQueryService,
      financialWorkspaceReadModelAdapter,
      currentOwnerId,
    });

    expect(suite.readModelApplication).toBeInstanceOf(
      FinancialReadModelApplication,
    );
    expect(
      suite.readModelApplication.financialWorkspaceQueryService,
    ).toBe(financialWorkspaceQueryService);
    expect(suite.readModelApplication.readModelAdapter).toBe(
      financialWorkspaceReadModelAdapter,
    );
    expect(suite.readModelApplication.currentOwnerId).toBe(
      currentOwnerId,
    );
    expect(suite.financialWorkspaceReadModelAdapter).toBe(
      financialWorkspaceReadModelAdapter,
    );
  });

  test("wires repository-backed financial position into the read model application", async () => {
    const financialWorkspaceQueryService = {
      buildWorkspace: vi.fn(),
    };

    const financialWorkspaceReadModelAdapter = {
      buildDashboard: vi.fn(),
      buildReports: vi.fn(),
    };

    const financialAccountRepository = {
      findByOwnerId: vi.fn(),
    };

    const accountBalanceRepository = {
      findLatestByOwnerId: vi.fn(),
    };

    const financialPositionQueryService = {
      buildPosition: vi.fn(),
    };

    const financialPositionReadModelAdapter = {
      buildPosition: vi.fn(),
    };

    const currentOwnerId = vi.fn(async () => "owner-1");

    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
      financialWorkspaceQueryService,
      financialWorkspaceReadModelAdapter,
      financialAccountRepository,
      accountBalanceRepository,
      financialPositionQueryService,
      financialPositionReadModelAdapter,
      currentOwnerId,
    });

    expect(suite.readModelApplication).toBeInstanceOf(
      FinancialReadModelApplication,
    );

    expect(
      suite.readModelApplication.financialPositionQueryService,
    ).toBe(financialPositionQueryService);

    expect(
      suite.readModelApplication.financialPositionReadModelAdapter,
    ).toBe(financialPositionReadModelAdapter);

    expect(suite.financialPositionQueryService).toBe(
      financialPositionQueryService,
    );

    expect(suite.financialPositionReadModelAdapter).toBe(
      financialPositionReadModelAdapter,
    );

    expect(suite.financialAccountRepository).toBe(financialAccountRepository);
    expect(suite.accountBalanceRepository).toBe(
      accountBalanceRepository,
    );
  });

  test("constructs the financial position query service from injected repositories", async () => {
    const financialAccountRepository = {
      findByOwnerId: vi.fn(),
    };

    const accountBalanceRepository = {
      findLatestByOwnerId: vi.fn(),
    };

    const positionNetWorthService = {
      calculate: vi.fn(),
    };

    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
      financialAccountRepository,
      accountBalanceRepository,
      positionNetWorthService,
    });

    expect(suite.financialPositionQueryService.financialAccountRepository).toBe(
      financialAccountRepository,
    );

    expect(
      suite.financialPositionQueryService.accountBalanceRepository,
    ).toBe(accountBalanceRepository);

    expect(
      suite.financialPositionQueryService.netWorthService,
    ).toBe(positionNetWorthService);

    expect(
      suite.readModelApplication.financialPositionQueryService,
    ).toBe(suite.financialPositionQueryService);

    expect(
      suite.readModelApplication.financialPositionReadModelAdapter,
    ).toBe(suite.financialPositionReadModelAdapter);
  });

  test("allows financial read model application injection", async () => {
    const readModelApplication = {};

    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
      readModelApplication,
    });

    expect(suite.readModelApplication).toBe(readModelApplication);
  });

  test("wires the default decision outcome query path into the read model application", async () => {
    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
    });

    expect(suite.decisionOutcomeRepository).toBeInstanceOf(
      InMemoryDecisionOutcomeRepository,
    );

    expect(suite.decisionOutcomeQueryService).toBeInstanceOf(
      DecisionOutcomeQueryService,
    );

    expect(
      suite.decisionOutcomeQueryService.decisionOutcomeRepository,
    ).toBe(suite.decisionOutcomeRepository);

    expect(
      suite.readModelApplication.decisionOutcomeQueryService,
    ).toBe(suite.decisionOutcomeQueryService);

    expect(
      suite.readModelApplication.decisionOutcomeReadModelAdapter,
    ).toBe(suite.decisionOutcomeReadModelAdapter);
  });

  test("constructs the decision outcome query service from an injected repository", async () => {
    const decisionOutcomeRepository = {
      findByDecisionId: vi.fn(),
    };

    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
      decisionOutcomeRepository,
    });

    expect(suite.decisionOutcomeRepository).toBe(
      decisionOutcomeRepository,
    );

    expect(
      suite.decisionOutcomeQueryService.decisionOutcomeRepository,
    ).toBe(decisionOutcomeRepository);

    expect(
      suite.readModelApplication.decisionOutcomeQueryService,
    ).toBe(suite.decisionOutcomeQueryService);
  });

  test("allows decision outcome query service injection", async () => {
    const decisionOutcomeQueryService = {
      findByDecisionId: vi.fn(),
    };

    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
      decisionOutcomeQueryService,
    });

    expect(suite.decisionOutcomeQueryService).toBe(
      decisionOutcomeQueryService,
    );

    expect(
      suite.readModelApplication.decisionOutcomeQueryService,
    ).toBe(decisionOutcomeQueryService);
  });

  test("wires decision outcome read model adapter into the suite", async () => {
    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
    });

    expect(
      suite.decisionOutcomeReadModelAdapter,
    ).toBeInstanceOf(
      DecisionOutcomeReadModelAdapter,
    );
  });

  test("allows decision outcome read model adapter injection", async () => {
    const decisionOutcomeReadModelAdapter = {
      buildOutcome() {},
    };

    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
      decisionOutcomeReadModelAdapter,
    });

    expect(
      suite.decisionOutcomeReadModelAdapter,
    ).toBe(
      decisionOutcomeReadModelAdapter,
    );
  });

  test("wires financial intelligence application into the suite", async () => {
    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
    });

    expect(suite.financialIntelligenceApplication).toBeInstanceOf(
      FinancialIntelligenceApplication,
    );
  });

  test("injects financial intelligence domain services from the composition root", async () => {
    const trendAnalysisService = {};
    const scenarioModelingService = {};
    const forecastService = {};
    const recommendationService = {};
    const planningService = {};

    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
      trendAnalysisService,
      scenarioModelingService,
      forecastService,
      recommendationService,
      planningService,
    });

    expect(suite.financialIntelligenceApplication.trendAnalysisService).toBe(
      trendAnalysisService,
    );
    expect(suite.financialIntelligenceApplication.scenarioModelingService).toBe(
      scenarioModelingService,
    );
    expect(suite.financialIntelligenceApplication.forecastService).toBe(
      forecastService,
    );
    expect(suite.financialIntelligenceApplication.recommendationService).toBe(
      recommendationService,
    );
    expect(suite.financialIntelligenceApplication.planningService).toBe(
      planningService,
    );
  });

  test("wires financial decision application into the suite", async () => {
    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
    });

    expect(suite.financialDecisionApplication).toBeInstanceOf(
      FinancialDecisionApplication,
    );
  });

  test("allows financial decision application injection", async () => {
    const financialDecisionApplication = {};

    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
      financialDecisionApplication,
    });

    expect(suite.financialDecisionApplication).toBe(
      financialDecisionApplication,
    );
  });

  test("wires financial decision outcome application into the suite", async () => {
    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
    });

    expect(
      suite.financialDecisionOutcomeApplication,
    ).toBeInstanceOf(
      FinancialDecisionOutcomeApplication,
    );
  });

  test("injects the decision outcome repository into the outcome application", async () => {
    const decisionOutcomeRepository = {
      save: vi.fn(),
      findByDecisionId: vi.fn(),
    };

    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
      decisionOutcomeRepository,
    });

    expect(
      suite.financialDecisionOutcomeApplication
        .decisionOutcomeRepository,
    ).toBe(decisionOutcomeRepository);
  });

  test("allows financial decision outcome application injection", async () => {
    const financialDecisionOutcomeApplication = {};

    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
      financialDecisionOutcomeApplication,
    });

    expect(
      suite.financialDecisionOutcomeApplication,
    ).toBe(
      financialDecisionOutcomeApplication,
    );
  });

  test("wires financial decision operations application into the suite", async () => {
    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
    });

    expect(
      suite.financialDecisionOperationsApplication,
    ).toBeInstanceOf(
      FinancialDecisionOperationsApplication,
    );
  });

  test("allows financial decision operations application injection", async () => {
    const financialDecisionOperationsApplication = {};

    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
      financialDecisionOperationsApplication,
    });

    expect(
      suite.financialDecisionOperationsApplication,
    ).toBe(
      financialDecisionOperationsApplication,
    );
  });

  test("allows financial intelligence application injection", async () => {
    const financialIntelligenceApplication = {};

    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
      financialIntelligenceApplication,
    });

    expect(suite.financialIntelligenceApplication).toBe(
      financialIntelligenceApplication,
    );
  });
  test("wires financial operations application into the suite", async () => {
    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
    });

    expect(suite.financialOperationsApplication).toBeInstanceOf(
      FinancialOperationsApplication,
    );
  });

  test("wires financial operations service into the suite", async () => {
    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
    });

    expect(suite.financialOperationsService).toBeInstanceOf(
      FinancialOperationsService,
    );
    expect(suite.financialOperationsApplication.financialOperationsService).toBe(
      suite.financialOperationsService,
    );
  });

  test("allows financial operations service injection", async () => {
    const financialOperationsService = {};

    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
      financialOperationsService,
    });

    expect(suite.financialOperationsService).toBe(financialOperationsService);
    expect(suite.financialOperationsApplication.financialOperationsService).toBe(
      financialOperationsService,
    );
  });

  test("allows financial operations application injection", async () => {
    const financialOperationsApplication = {};

    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
      financialOperationsApplication,
    });

    expect(suite.financialOperationsApplication).toBe(
      financialOperationsApplication,
    );
  });

  test("wires financial snapshot view application into the suite", async () => {
    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
    });

    expect(suite.financialSnapshotViewApplication).toBeInstanceOf(
      FinancialSnapshotViewApplication,
    );
  });

  test("allows financial snapshot view application injection", async () => {
    const financialSnapshotViewApplication = {};

    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
      financialSnapshotViewApplication,
    });

    expect(suite.financialSnapshotViewApplication).toBe(
      financialSnapshotViewApplication,
    );
  });

  test("wires financial import application into the suite", async () => {
    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
    });

    expect(suite.financialImportApplication).toBeInstanceOf(
      FinancialImportApplication,
    );
  });

  test("allows financial import application injection", async () => {
    const financialImportApplication = {};

    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
      financialImportApplication,
    });

    expect(suite.financialImportApplication).toBe(
      financialImportApplication,
    );
  });

  test("registers transaction review query service with an injected projection service", async () => {
    const financialEventRepository = {
      findByOwnerId: vi.fn(async () => []),
    };

    const transactionReviewProjectionService = {
      project: vi.fn(),
    };

    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
      financialEventRepository,
      transactionReviewProjectionService,
    });

    expect(
      suite.transactionReviewQueryService,
    ).toBeInstanceOf(
      TransactionReviewQueryService,
    );

    expect(
      suite.transactionReviewQueryService
        .financialEventRepository,
    ).toBe(financialEventRepository);

    expect(
      suite.transactionReviewQueryService
        .projectionService,
    ).toBe(transactionReviewProjectionService);
  });

  test("allows transaction review query service injection", async () => {
    const transactionReviewQueryService = {};

    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
      transactionReviewQueryService,
    });

    expect(
      suite.transactionReviewQueryService,
    ).toBe(transactionReviewQueryService);
  });

  test("leaves transaction review query service unregistered without a projection service", async () => {
    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
    });

    expect(
      suite.transactionReviewQueryService,
    ).toBeNull();
  });

  test("registers the default transaction review read model adapter", async () => {
    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
    });

    expect(
      suite.transactionReviewReadModelAdapter,
    ).toBe(transactionReviewReadModelAdapter);
  });

  test("allows transaction review read model adapter injection", async () => {
    const injectedAdapter = {
      buildQueue: vi.fn(),
    };

    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
      transactionReviewReadModelAdapter:
        injectedAdapter,
    });

    expect(
      suite.transactionReviewReadModelAdapter,
    ).toBe(injectedAdapter);
  });

  test("wires transaction review application into the suite", async () => {
    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
    });

    expect(suite.transactionReviewApplication).toBeInstanceOf(
      TransactionReviewApplication,
    );
  });

  test("allows transaction review application injection", async () => {
    const transactionReviewApplication = {};

    const suite = await createFinancialApplicationSuite({
      engine: {},
      dashboardService: {},
      snapshotApplication: {},
      snapshotRepository: {},
      transactionReviewApplication,
    });

    expect(suite.transactionReviewApplication).toBe(
      transactionReviewApplication,
    );
  });

  test("builds default applications with usable financial data", async () => {
    const suite = await createFinancialApplicationSuite({
      financialEventRepository: {
        findByOwnerId: vi.fn(async () => []),
      },
      financialAccountRepository: {
        findByOwnerId: vi.fn(async () => []),
      },
      accountBalanceRepository: {
        findLatestByOwnerId: vi.fn(async () => []),
      },
      currentOwnerId: vi.fn(async () => "owner-test"),
    });

    const snapshot =
      await suite.snapshotApplication.captureDashboardSnapshot();

    const operations =
      await suite.financialOperationsApplication.buildFinancialOperations();

    expect(snapshot.dashboard).toBeDefined();
    expect(operations.type).toBe("financial-operations");
    expect(Array.isArray(operations.actions)).toBe(true);
  });
});
