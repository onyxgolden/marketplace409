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
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@/infrastructure/composition", () => ({
  createFinancialApplicationSuite:
    mocks.createFinancialApplicationSuite,
}));

import {
  createAuthenticatedFinancialApplication,
} from "./createAuthenticatedFinancialApplication";

describe("createAuthenticatedFinancialApplication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an authenticated financial application suite", async () => {
    const user = {
      id: "owner-1",
    };

    const supabaseClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user,
          },
          error: null,
        }),
      },
    };

    const financialApplicationSuite = {
      readModelApplication: {},
    };

    mocks.createClient.mockResolvedValue(
      supabaseClient,
    );

    mocks.createFinancialApplicationSuite.mockResolvedValue(
      financialApplicationSuite,
    );

    const result =
      await createAuthenticatedFinancialApplication();

    expect(result).toMatchObject({
      supabaseClient,
      user,
      getFinancialApplicationSuite:
        expect.any(Function),
    });

    expect(
      mocks.createFinancialApplicationSuite,
    ).not.toHaveBeenCalled();

    await expect(
      result.getFinancialApplicationSuite(),
    ).resolves.toBe(financialApplicationSuite);

    expect(
      mocks.createFinancialApplicationSuite,
    ).toHaveBeenCalledTimes(1);

    expect(
      mocks.createFinancialApplicationSuite,
    ).toHaveBeenCalledWith({
      supabaseClient,
      ownerId: "owner-1",
      currentOwnerId: expect.any(Function),
    });

    await expect(
      result.currentOwnerId(),
    ).resolves.toBe("owner-1");
  });

  it("returns 401 when no authenticated user exists", async () => {
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

    const result =
      await createAuthenticatedFinancialApplication();

    expect(result.response.status).toBe(401);

    await expect(
      result.response.json(),
    ).resolves.toEqual({
      error:
        "Authenticated owner id is required.",
    });

    expect(
      mocks.createFinancialApplicationSuite,
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

    const result =
      await createAuthenticatedFinancialApplication();

    expect(result.response.status).toBe(401);

    await expect(
      result.response.json(),
    ).resolves.toEqual({
      error:
        "Authenticated owner id is required.",
    });

    expect(
      mocks.createFinancialApplicationSuite,
    ).not.toHaveBeenCalled();
  });
});
