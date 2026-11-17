import { beforeEach, describe, expect, it, vi } from "vitest";

// Direct tests for the fail-closed boolean helper and the per-request
// memoization in loadProgrammerAuthorization.js. The layout wiring tests
// mock this module, so they cannot catch a wrong boolean here — and the
// helper is load-bearing for every promoted layout. Each case re-imports
// the module fresh (vi.resetModules) because React cache() memoizes per
// module instance; without the fresh import, one case's cached result
// would leak into the next.
const mocks = vi.hoisted(() => ({
  createClient: vi.fn(() => Promise.resolve({ auth: {} })),
  loadAuthorization: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@/application/developer/ProgrammerAuthorizationApplication", () => ({
  // NOTE: a plain function, not an arrow — the loader constructs this
  // class with `new`, and arrow functions are not constructors.
  ProgrammerAuthorizationApplication: vi.fn(function () {
    return { loadAuthorization: mocks.loadAuthorization };
  }),
}));

async function loadLoaderFresh() {
  vi.resetModules();
  return import("@/lib/supabase/loadProgrammerAuthorization");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createClient.mockImplementation(() => Promise.resolve({ auth: {} }));
});

describe("isProgrammerAuthorized", () => {
  it("returns true only when the server check says ok and authorized", async () => {
    mocks.loadAuthorization.mockResolvedValue({ ok: true, authorized: true });
    const { isProgrammerAuthorized } = await loadLoaderFresh();
    expect(await isProgrammerAuthorized()).toBe(true);
  });

  it("returns false when authorized is false", async () => {
    mocks.loadAuthorization.mockResolvedValue({ ok: true, authorized: false });
    const { isProgrammerAuthorized } = await loadLoaderFresh();
    expect(await isProgrammerAuthorized()).toBe(false);
  });

  it("returns false when ok is false", async () => {
    mocks.loadAuthorization.mockResolvedValue({ ok: false, authorized: true });
    const { isProgrammerAuthorized } = await loadLoaderFresh();
    expect(await isProgrammerAuthorized()).toBe(false);
  });

  it("returns false when the check throws — fail closed, never grants on error", async () => {
    mocks.loadAuthorization.mockRejectedValue(new Error("supabase down"));
    const { isProgrammerAuthorized } = await loadLoaderFresh();
    expect(await isProgrammerAuthorized()).toBe(false);
  });

  // NOTE: the per-request memoization (React cache()) is NOT asserted here:
  // cache() only dedupes inside a Next.js request store, and vitest has no
  // request store — outside one, every call runs the underlying function
  // (verified: sequential and concurrent calls each invoke it). The dedup
  // claim rests on React's documented cache() semantics for server
  // components, not on a unit test. What IS asserted here is the boolean
  // logic, which the layout wiring tests cannot catch because they mock
  // this module.
});
