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
  buildFinancialOperations: vi.fn(),
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
  };

  mocks.createClient.mockResolvedValue(
    supabaseClient,
  );

  mocks.createFinancialApplicationSuite.mockResolvedValue({
    financialOperationsApplication: {
      buildFinancialOperations:
        mocks.buildFinancialOperations,
    },
  });

  return supabaseClient;
}

describe("GET /api/financial/operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.buildFinancialOperations.mockResolvedValue({
      type: "financial-operations",
      status: "ready",
    });
  });

  it("returns authenticated financial operations", async () => {
    const supabaseClient =
      configureAuthenticatedRequest();

    const response = await GET();

    expect(response.status).toBe(200);

    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        type: "financial-operations",
        status: "ready",
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
      mocks.buildFinancialOperations,
    ).toHaveBeenCalledTimes(1);
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

    const response = await GET();

    expect(response.status).toBe(401);

    await expect(response.json()).resolves.toEqual({
      error:
        "Authenticated owner id is required.",
    });

    expect(
      mocks.createFinancialApplicationSuite,
    ).not.toHaveBeenCalled();

    expect(
      mocks.buildFinancialOperations,
    ).not.toHaveBeenCalled();
  });

  it("returns 401 when authentication fails", async () => {
    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: null,
          },
          error: new Error(
            "Authentication unavailable.",
          ),
        }),
      },
    });

    const response = await GET();

    expect(response.status).toBe(401);

    await expect(response.json()).resolves.toEqual({
      error:
        "Authenticated owner id is required.",
    });

    expect(
      mocks.createFinancialApplicationSuite,
    ).not.toHaveBeenCalled();
  });

  it("returns 500 when financial operations execution fails", async () => {
    configureAuthenticatedRequest();

    mocks.buildFinancialOperations.mockRejectedValue(
      new Error("Operations repository unavailable."),
    );

    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const response = await GET();

    expect(response.status).toBe(500);

    await expect(response.json()).resolves.toEqual({
      error:
        "Operations repository unavailable.",
    });

    expect(consoleError).toHaveBeenCalledWith(
      "Financial operations error",
      expect.any(Error),
    );

    consoleError.mockRestore();
  });
});
