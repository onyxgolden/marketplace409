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
  createStripeBillingProvider: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@/infrastructure/billing/StripeBillingProvider", () => ({
  createStripeBillingProvider: mocks.createStripeBillingProvider,
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
      plaidSdk: expect.any(Object),
      stripeClientFactory: expect.any(Function),
      connectionRepositoryStorage:
        "supabase",
      credentialReferenceRepositoryStorage:
        "supabase",
      institutionReferenceRepositoryStorage:
        "supabase",
    });

    // The injected SDK must be the real plaid module surface (the single
    // static link to the ~17MB SDK), not a stub -- every Plaid entry point
    // depends on this wiring.
    const [suiteArgs] =
      mocks.createConnectionPlatformSuite.mock.calls[0];
    expect(suiteArgs.plaidSdk).toMatchObject({
      Configuration: expect.any(Function),
      PlaidApi: expect.any(Function),
      PlaidEnvironments: expect.any(Object),
    });

    // The injected Stripe factory must resolve to StripeBillingProvider's
    // configured SDK instance -- every Stripe Financial Connections entry
    // point depends on this wiring. The factory is async and lazy (dynamic
    // import inside) so the stripe package stays out of every route's
    // static bundle and this helper stays safe to construct unconfigured.
    const fakeStripe = {
      financialConnections: { sessions: { create: vi.fn() } },
      customers: { create: vi.fn() },
    };
    mocks.createStripeBillingProvider.mockReturnValue({ stripe: fakeStripe });
    const stripeClient = await suiteArgs.stripeClientFactory();
    expect(mocks.createStripeBillingProvider).toHaveBeenCalled();
    expect(stripeClient).toBe(fakeStripe);

    // The factory memoizes: repeated calls reuse the one configured SDK
    // instance instead of constructing a second Stripe client per call.
    const stripeClientAgain = await suiteArgs.stripeClientFactory();
    expect(stripeClientAgain).toBe(fakeStripe);
    expect(mocks.createStripeBillingProvider).toHaveBeenCalledTimes(1);

    await expect(
      result.currentOwnerId(),
    ).resolves.toBe("owner-1");

    expect(result.effectiveOwnerId).toBe("owner-1");
  });

  it("shares one Stripe client across concurrent first-use factory calls", async () => {
    // The singleton promise must be cached before the first construction
    // finishes -- otherwise two simultaneous first Stripe operations would
    // each build their own SDK client. A fresh module instance is needed
    // because the singleton persists per module.
    vi.resetModules();
    const { createAuthenticatedConnectionApplication: freshHelper } =
      await import("./createAuthenticatedConnectionApplication");

    const supabaseClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "owner-1" } },
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
    mocks.createConnectionPlatformSuite.mockResolvedValue({});

    const fakeStripe = {
      financialConnections: { sessions: { create: vi.fn() } },
    };
    mocks.createStripeBillingProvider.mockReturnValue({
      stripe: fakeStripe,
    });

    const result = await freshHelper();
    await result.getConnectionPlatformSuite();
    const [suiteArgs] =
      mocks.createConnectionPlatformSuite.mock.calls.at(-1);

    const [first, second] = await Promise.all([
      suiteArgs.stripeClientFactory(),
      suiteArgs.stripeClientFactory(),
    ]);
    expect(first).toBe(fakeStripe);
    expect(second).toBe(fakeStripe);
    expect(mocks.createStripeBillingProvider).toHaveBeenCalledTimes(1);
  });

  it("resolves effectiveOwnerId to the workspace owner when acting as an active co-owner, not the actor's own id", async () => {
    const user = { id: "co-owner-uuid" };

    const supabaseClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
      },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(function eq() {
            return this;
          }),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { owner_id: "primary-owner-uuid" },
            error: null,
          }),
        })),
      })),
    };

    mocks.createClient.mockResolvedValue(supabaseClient);
    mocks.createConnectionPlatformSuite.mockResolvedValue({});

    const result = await createAuthenticatedConnectionApplication();

    expect(result.user.id).toBe("co-owner-uuid");
    expect(result.effectiveOwnerId).toBe("primary-owner-uuid");
    await expect(result.currentOwnerId()).resolves.toBe("primary-owner-uuid");
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
