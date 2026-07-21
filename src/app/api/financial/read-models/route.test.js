import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  createFinancialApplicationSuite: vi.fn(),
  buildFinancialDashboard: vi.fn(),
  buildBusinessDashboard: vi.fn(),
  buildInvestorDashboard: vi.fn(),
  buildKPIModel: vi.fn(),
  buildExecutiveSummary: vi.fn(),
  buildDecisionOutcome: vi.fn(),
}));

vi.mock("@/infrastructure/composition", () => ({
  createFinancialApplicationSuite:
    mocks.createFinancialApplicationSuite,
}));

import {
  GET,
} from "./route";

function createRequest(query = "") {
  return new Request(
    `http://localhost/api/financial/read-models${query}`,
  );
}

function configureApplication() {
  mocks.createFinancialApplicationSuite.mockResolvedValue({
    readModelApplication: {
      buildFinancialDashboard:
        mocks.buildFinancialDashboard,
      buildBusinessDashboard:
        mocks.buildBusinessDashboard,
      buildInvestorDashboard:
        mocks.buildInvestorDashboard,
      buildKPIModel:
        mocks.buildKPIModel,
      buildExecutiveSummary:
        mocks.buildExecutiveSummary,
      buildDecisionOutcome:
        mocks.buildDecisionOutcome,
    },
  });
}

describe("GET /api/financial/read-models", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.buildFinancialDashboard.mockResolvedValue(null);
    mocks.buildBusinessDashboard.mockResolvedValue(null);
    mocks.buildInvestorDashboard.mockResolvedValue(null);
    mocks.buildKPIModel.mockResolvedValue(null);
    mocks.buildExecutiveSummary.mockResolvedValue(null);
    mocks.buildDecisionOutcome.mockResolvedValue(null);

    configureApplication();
  });

  it("returns a projected decision outcome", async () => {
    const decisionOutcome = Object.freeze({
      type: "decision-outcome",
      decisionId: "decision-1",
      status: "completed",
      evaluation: {
        score: 0.9,
      },
      outcome: {
        result: "approved",
      },
      metadata: {
        provider: "decision-outcome",
        projectionStatus: "evaluation-backed",
        phase: "17E",
      },
    });

    mocks.buildDecisionOutcome.mockResolvedValue(
      decisionOutcome,
    );

    const response = await GET(
      createRequest(
        "?decisionOutcome=true&decisionId=decision-1",
      ),
    );

    expect(response.status).toBe(200);

    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        financial: null,
        business: null,
        investor: null,
        kpi: null,
        executive: null,
        decisionOutcome,
      },
    });

    expect(
      mocks.buildDecisionOutcome,
    ).toHaveBeenCalledWith("decision-1");
  });

  it("returns 400 when the decision id is missing", async () => {
    const response = await GET(
      createRequest("?decisionOutcome=true"),
    );

    expect(response.status).toBe(400);

    await expect(response.json()).resolves.toEqual({
      error:
        "Decision id is required when decisionOutcome=true.",
    });

    expect(
      mocks.createFinancialApplicationSuite,
    ).not.toHaveBeenCalled();
  });

  it("returns null when no decision outcome exists", async () => {
    const response = await GET(
      createRequest(
        "?decisionOutcome=true&decisionId=unknown-decision",
      ),
    );

    expect(response.status).toBe(200);

    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        financial: null,
        business: null,
        investor: null,
        kpi: null,
        executive: null,
        decisionOutcome: null,
      },
    });
  });

  it("preserves existing dashboard projections", async () => {
    const financial = {
      type: "financial-dashboard",
    };

    mocks.buildFinancialDashboard.mockResolvedValue(
      financial,
    );

    const response = await GET(
      createRequest("?financial=true"),
    );

    expect(response.status).toBe(200);

    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        financial,
        business: null,
        investor: null,
        kpi: null,
        executive: null,
        decisionOutcome: null,
      },
    });

    expect(
      mocks.buildDecisionOutcome,
    ).not.toHaveBeenCalled();
  });
});
