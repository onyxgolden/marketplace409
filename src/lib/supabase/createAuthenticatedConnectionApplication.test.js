import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createConnectionPlatformSuite: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@/infrastructure/composition", () => ({
  ConnectionRepositoryStorage: {
    SUPABASE: "supabase",
  },
  CredentialReferenceRepositoryStorage: {
    SUPABASE: "supabase",
  },
  InstitutionReferenceRepositoryStorage: {
    SUPABASE: "supabase",
  },
  createConnectionPlatformSuite:
    mocks.createConnectionPlatformSuite,
}));

import {
  createAuthenticatedConnectionApplication,
} from "./createAuthenticatedConnectionApplication";

describe("createAuthenticatedConnectionApplication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an authenticated connection platform suite", async () => {
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

    const connectionPlatformSuite = {
      readModelApplication: {},
    };

    mocks.createClient.mockResolvedValue(
      supabaseClient,
    );

    mocks.createConnectionPlatformSuite.mockResolvedValue(
      connectionPlatformSuite,
    );

    const result =
      await createAuthenticatedConnectionApplication();

    expect(result).toMatchObject({
      supabaseClient,
      user,
      getConnectionPlatformSuite:
        expect.any(Function),
    });

    expect(
      mocks.createConnectionPlatformSuite,
    ).not.toHaveBeenCalled();

    await expect(
      result.getConnectionPlatformSuite(),
    ).resolves.toBe(connectionPlatformSuite);

    expect(
      mocks.createConnectionPlatformSuite,
    ).toHaveBeenCalledTimes(1);

    expect(
      mocks.createConnectionPlatformSuite,
    ).toHaveBeenCalledWith({
      supabaseClient,
      ownerId: "owner-1",
      currentOwnerId: expect.any(Function),
      connectionRepositoryStorage:
        "supabase",
      credentialReferenceRepositoryStorage:
        "supabase",
      institutionReferenceRepositoryStorage:
        "supabase",
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
      await createAuthenticatedConnectionApplication();

    expect(result.response.status).toBe(401);

    await expect(
      result.response.json(),
    ).resolves.toEqual({
      error:
        "Authenticated owner id is required.",
    });

    expect(
      mocks.createConnectionPlatformSuite,
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
      await createAuthenticatedConnectionApplication();

    expect(result.response.status).toBe(401);

    await expect(
      result.response.json(),
    ).resolves.toEqual({
      error:
        "Authenticated owner id is required.",
    });

    expect(
      mocks.createConnectionPlatformSuite,
    ).not.toHaveBeenCalled();
  });
});
