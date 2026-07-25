import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createForgeApplicationSuite: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@/infrastructure/composition", () => ({
  createForgeApplicationSuite:
    mocks.createForgeApplicationSuite,
}));

import {
  createAuthenticatedForgeApplication,
} from "./createAuthenticatedForgeApplication";

describe("createAuthenticatedForgeApplication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an authenticated forge application suite", async () => {
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

    const forgeApplicationSuite = {
      connectionPlatformSuite: {},
      financialApplicationSuite: {},
    };

    mocks.createClient.mockResolvedValue(
      supabaseClient,
    );

    mocks.createForgeApplicationSuite.mockResolvedValue(
      forgeApplicationSuite,
    );

    const result =
      await createAuthenticatedForgeApplication();

    expect(result).toMatchObject({
      supabaseClient,
      user,
      getForgeApplicationSuite:
        expect.any(Function),
    });

    expect(
      mocks.createForgeApplicationSuite,
    ).not.toHaveBeenCalled();

    await expect(
      result.getForgeApplicationSuite(),
    ).resolves.toBe(forgeApplicationSuite);

    expect(
      mocks.createForgeApplicationSuite,
    ).toHaveBeenCalledTimes(1);

    expect(
      mocks.createForgeApplicationSuite,
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
      await createAuthenticatedForgeApplication();

    expect(result.response.status).toBe(401);

    await expect(
      result.response.json(),
    ).resolves.toEqual({
      error:
        "Authenticated owner id is required.",
    });

    expect(
      mocks.createForgeApplicationSuite,
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
      await createAuthenticatedForgeApplication();

    expect(result.response.status).toBe(401);

    await expect(
      result.response.json(),
    ).resolves.toEqual({
      error:
        "Authenticated owner id is required.",
    });

    expect(
      mocks.createForgeApplicationSuite,
    ).not.toHaveBeenCalled();
  });
});
