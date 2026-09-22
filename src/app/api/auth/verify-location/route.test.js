import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashLocationActionToken } from "@/lib/auth/loginSafetyTokens.js";

const mockCreateServiceClient = vi.fn();

vi.mock("@/lib/supabase/createLoginSafetyServiceClient", () => ({
  createLoginSafetyServiceClient: (...args) => mockCreateServiceClient(...args),
}));

const { GET } = await import("./route.js");

const RAW_TOKEN = "a".repeat(64);
const TOKEN_HASH = hashLocationActionToken(RAW_TOKEN);
const OTHER_HASH = hashLocationActionToken("b".repeat(64));

function futureIso() {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString();
}

function fakeServiceDb({ tokenRow, consumeResult, locationUpdateResult, locationInsertResult }) {
  const order = [];
  const calls = [];
  const locationChain = {
    eq: () => locationChain,
    is: () => locationChain,
    select: async () => locationUpdateResult,
  };
  return {
    order,
    calls,
    from: (table) => {
      if (table === "location_action_tokens") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: tokenRow, error: null }) }),
          }),
          update: (patch) => {
            calls.push({ kind: "tokenUpdate", patch });
            return {
              eq: () => ({
                is: () => {
                  order.push("consume");
                  return { select: async () => consumeResult };
                },
              }),
            };
          },
        };
      }
      if (table === "known_login_locations") {
        return {
          update: (patch) => {
            order.push("apply");
            calls.push({ kind: "locationUpdate", patch });
            return { eq: () => locationChain };
          },
          insert: async (row) => {
            calls.push({ kind: "locationInsert", row });
            return locationInsertResult;
          },
        };
      }
      if (table === "login_history") {
        return {
          update: (patch) => {
            order.push("flag");
            calls.push({ kind: "historyFlag", patch });
            return {
              eq: (col, val) => {
                calls.push({ kind: "historyFlagEq", col, val });
                return Promise.resolve({ data: [{ id: val }], error: null });
              },
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

function validTokenRow(overrides = {}) {
  return {
    id: "token-row-1",
    user_id: "user-real-1111",
    token_hash: TOKEN_HASH,
    action: "approve",
    login_history_id: "login-1",
    country: "US",
    city: "Austin",
    expires_at: futureIso(),
    used_at: null,
    ...overrides,
  };
}

function getRequest(token, action) {
  return new Request(`https://example.test/auth/verify-location?token=${token}&action=${action}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SITE_URL = "https://409marketplace.online";
});

describe("GET /api/auth/verify-location", () => {
  it("rejects malformed tokens and actions with a generic page", async () => {
    const service = fakeServiceDb({ tokenRow: validTokenRow(), consumeResult: { data: [{ id: "x" }], error: null }, locationUpdateResult: { data: [{ id: "loc-1" }], error: null }, locationInsertResult: { error: null } });
    mockCreateServiceClient.mockReturnValue(service);

    for (const [token, action] of [["short", "approve"], [RAW_TOKEN, "maybe"], ["", ""], ["zzzz", "deny"]]) {
      const res = await GET(getRequest(token, action));
      expect(await res.text()).toContain("invalid or expired");
    }
    expect(service.calls).toHaveLength(0);
  });

  it("rejects unknown, expired, and already-used tokens generically", async () => {
    const cases = [
      validTokenRow({ token_hash: OTHER_HASH }), // hash mismatch (unknown token)
      validTokenRow({ expires_at: new Date(Date.now() - 1000).toISOString() }),
      validTokenRow({ used_at: new Date().toISOString() }),
    ];
    for (const tokenRow of cases) {
      const service = fakeServiceDb({ tokenRow, consumeResult: { data: [{ id: "x" }], error: null }, locationUpdateResult: { data: [{ id: "loc-1" }], error: null }, locationInsertResult: { error: null } });
      mockCreateServiceClient.mockReturnValue(service);
      const res = await GET(getRequest(RAW_TOKEN, "approve"));
      const text = await res.text();
      expect(text).toContain("invalid or expired");
      expect(text).not.toContain("Austin");
    }
  });

  it("consumes the token before applying approve, then marks the location approved", async () => {
    const service = fakeServiceDb({
      tokenRow: validTokenRow(),
      consumeResult: { data: [{ id: "token-row-1" }], error: null },
      locationUpdateResult: { data: [{ id: "loc-1" }], error: null },
      locationInsertResult: { error: null },
    });
    mockCreateServiceClient.mockReturnValue(service);

    const res = await GET(getRequest(RAW_TOKEN, "approve"));
    const text = await res.text();

    // Consume-before-apply ordering (replay protection).
    expect(service.order).toEqual(["consume", "apply"]);
    const update = service.calls.find((c) => c.kind === "locationUpdate");
    expect(update.patch.status).toBe("approved");
    expect(update.patch.approved_at).toBeTruthy();
    expect(service.calls.some((c) => c.kind === "locationInsert")).toBe(false);
    expect(text).toContain("Your security preference has been updated.");
    expect(text).not.toContain("invalid or expired");
  });

  it("marks the location denied and shows secure-account guidance", async () => {
    const service = fakeServiceDb({
      tokenRow: validTokenRow({ action: "deny" }),
      consumeResult: { data: [{ id: "token-row-1" }], error: null },
      locationUpdateResult: { data: [{ id: "loc-1" }], error: null },
      locationInsertResult: { error: null },
    });
    mockCreateServiceClient.mockReturnValue(service);

    const res = await GET(getRequest(RAW_TOKEN, "deny"));
    const text = await res.text();

    const update = service.calls.find((c) => c.kind === "locationUpdate");
    expect(update.patch.status).toBe("denied");
    expect(update.patch.approved_at).toBeUndefined();
    expect(text).toContain("Your security preference has been updated.");
    expect(text).toContain("https://409marketplace.online/auth/reset-password");
  });

  it("treats a lost consume race as invalid (no double-apply)", async () => {
    const service = fakeServiceDb({
      tokenRow: validTokenRow(),
      consumeResult: { data: [], error: null }, // another request consumed it first
      locationUpdateResult: { data: [{ id: "loc-1" }], error: null },
      locationInsertResult: { error: null },
    });
    mockCreateServiceClient.mockReturnValue(service);

    const res = await GET(getRequest(RAW_TOKEN, "approve"));
    expect(await res.text()).toContain("invalid or expired");
    expect(service.calls.some((c) => c.kind === "locationUpdate" || c.kind === "locationInsert")).toBe(false);
  });

  it("inserts the baseline row when the location was never recorded", async () => {
    const service = fakeServiceDb({
      tokenRow: validTokenRow({ country: null, city: null }),
      consumeResult: { data: [{ id: "token-row-1" }], error: null },
      locationUpdateResult: { data: [], error: null }, // no existing row
      locationInsertResult: { error: null },
    });
    mockCreateServiceClient.mockReturnValue(service);

    const res = await GET(getRequest(RAW_TOKEN, "approve"));
    const text = await res.text();

    expect(text).toContain("Your security preference has been updated.");
    const insert = service.calls.find((c) => c.kind === "locationInsert");
    expect(insert.row.status).toBe("approved");
    expect(insert.row.user_id).toBe("user-real-1111");
    expect(insert.row.country).toBeNull();
    expect(insert.row.city).toBeNull();
  });

  it("rejects an action that does not match the token's bound action", async () => {
    // Approve token presented with action=deny must NOT flip anything, and
    // must NOT consume the token (the owner can still use the correct link).
    const service = fakeServiceDb({
      tokenRow: validTokenRow({ action: "approve" }),
      consumeResult: { data: [{ id: "token-row-1" }], error: null },
      locationUpdateResult: { data: [{ id: "loc-1" }], error: null },
      locationInsertResult: { error: null },
    });
    mockCreateServiceClient.mockReturnValue(service);

    const res = await GET(getRequest(RAW_TOKEN, "deny"));
    expect(await res.text()).toContain("invalid or expired");
    expect(service.calls.some((c) => c.kind === "tokenUpdate")).toBe(false);
    expect(service.order).not.toContain("apply");

    // And the mirror case: deny token with action=approve.
    const service2 = fakeServiceDb({
      tokenRow: validTokenRow({ action: "deny" }),
      consumeResult: { data: [{ id: "token-row-1" }], error: null },
      locationUpdateResult: { data: [{ id: "loc-1" }], error: null },
      locationInsertResult: { error: null },
    });
    mockCreateServiceClient.mockReturnValue(service2);

    const res2 = await GET(getRequest(RAW_TOKEN, "approve"));
    expect(await res2.text()).toContain("invalid or expired");
    expect(service2.order).not.toContain("apply");
  });

  it("flags the exact login_history row on deny, and never on approve", async () => {
    const denyService = fakeServiceDb({
      tokenRow: validTokenRow({ action: "deny", login_history_id: "login-exact-1" }),
      consumeResult: { data: [{ id: "token-row-1" }], error: null },
      locationUpdateResult: { data: [{ id: "loc-1" }], error: null },
      locationInsertResult: { error: null },
    });
    mockCreateServiceClient.mockReturnValue(denyService);

    const denyRes = await GET(getRequest(RAW_TOKEN, "deny"));
    expect(await denyRes.text()).toContain("Your security preference has been updated.");

    const flag = denyService.calls.find((c) => c.kind === "historyFlag");
    expect(flag.patch).toEqual({ flagged_suspicious: true });
    const flagEq = denyService.calls.find((c) => c.kind === "historyFlagEq");
    expect(flagEq.col).toBe("id");
    expect(flagEq.val).toBe("login-exact-1");
    // Flag happens after the location status apply (consume -> apply -> flag).
    expect(denyService.order).toEqual(["consume", "apply", "flag"]);

    const approveService = fakeServiceDb({
      tokenRow: validTokenRow({ action: "approve", login_history_id: "login-exact-2" }),
      consumeResult: { data: [{ id: "token-row-1" }], error: null },
      locationUpdateResult: { data: [{ id: "loc-1" }], error: null },
      locationInsertResult: { error: null },
    });
    mockCreateServiceClient.mockReturnValue(approveService);

    const approveRes = await GET(getRequest(RAW_TOKEN, "approve"));
    expect(await approveRes.text()).toContain("Your security preference has been updated.");
    expect(approveService.calls.some((c) => c.kind === "historyFlag")).toBe(false);
  });
});
