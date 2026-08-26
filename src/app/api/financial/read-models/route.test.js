import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createFinancialApplicationSuite: vi.fn(),
  buildFinancialDashboard: vi.fn(),
  buildBusinessDashboard: vi.fn(),
  buildInvestorDashboard: vi.fn(),
  buildKPIModel: vi.fn(),
  buildExecutiveSummary: vi.fn(),
  buildDecisionOutcome: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
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

function configureAuthenticatedRequest({
  userId = "owner-1",
} = {}) {
  const supabaseClient = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: {
            id: userId,
          },
        },
        error: null,
      }),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(function eq() {
          return this;
        }),
        maybeSingle: vi.fn().mockResolvedValue({
          data: null,
          error: null,
        }),
      })),
    })),
  };

  mocks.createClient.mockResolvedValue(supabaseClient);

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

  return supabaseClient;
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
  });

  it("returns a projected decision outcome", async () => {
    const supabaseClient =
      configureAuthenticatedRequest();

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
      mocks.createFinancialApplicationSuite,
    ).toHaveBeenCalledWith({
      supabaseClient,
      ownerId: "owner-1",
      currentOwnerId: expect.any(Function),
    });

    const {
      currentOwnerId,
    } = mocks.createFinancialApplicationSuite.mock.calls[0][0];

    await expect(currentOwnerId()).resolves.toBe(
      "owner-1",
    );

    expect(
      mocks.buildDecisionOutcome,
    ).toHaveBeenCalledTimes(1);

    expect(
      mocks.buildDecisionOutcome,
    ).toHaveBeenCalledWith("decision-1");
  });

  it("returns 400 when decision outcome is requested without a decision id", async () => {
    configureAuthenticatedRequest();

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

    expect(
      mocks.buildDecisionOutcome,
    ).not.toHaveBeenCalled();
  });

  it("returns null when no decision outcome exists", async () => {
    configureAuthenticatedRequest();

    mocks.buildDecisionOutcome.mockResolvedValue(null);

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

    expect(
      mocks.buildDecisionOutcome,
    ).toHaveBeenCalledWith(
      "unknown-decision",
    );
  });

  it("preserves existing dashboard projections", async () => {
    configureAuthenticatedRequest();

    const financial = {
      type: "financial-dashboard",
    };

    const business = {
      type: "business-dashboard",
    };

    mocks.buildFinancialDashboard.mockResolvedValue(
      financial,
    );

    mocks.buildBusinessDashboard.mockResolvedValue(
      business,
    );

    const response = await GET(
      createRequest(
        "?financial=true&business=true",
      ),
    );

    expect(response.status).toBe(200);

    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        financial,
        business,
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

  it("returns 401 when no authenticated owner exists", async () => {
    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: null,
          },
          error: null,
        }),
      },
    });

    const response = await GET(
      createRequest(
        "?decisionOutcome=true&decisionId=decision-1",
      ),
    );

    expect(response.status).toBe(401);

    await expect(response.json()).resolves.toEqual({
      error:
        "Authenticated owner id is required.",
    });

    expect(
      mocks.createFinancialApplicationSuite,
    ).not.toHaveBeenCalled();
  });
});
