import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock("@/lib/supabase/createAuthenticatedPrivateFinancingApplication", () => ({
  createAuthenticatedPrivateFinancingApplication: mocks.authenticate,
}));

import { POST } from "./route";

const params = Promise.resolve({ accountId: "pf_acct_1" });
const future = "2999-01-01T00:00:00.000Z";

function request(overrides = {}) {
  return new Request("https://test/servicing-policy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      paymentAcceptancePolicy: "full_amount_or_more",
      effectiveAt: future,
      reason: "Require the full scheduled amount",
      ...overrides,
    }),
  });
}

function client({ data, error = null } = {}) {
  return {
    rpc: vi.fn().mockResolvedValue({
      data:
        data ?? {
          id: "pf_pol_2",
          account_id: "pf_acct_1",
          version: 2,
          payment_acceptance_policy: "full_amount_or_more",
          effective_at: future,
          acting_seller_id: "co-owner-1",
          reason: "Require the full scheduled amount",
          recorded_at: "2026-08-30T16:00:00Z",
        },
      error,
    }),
  };
}

describe("POST private-financing servicing policy", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the canonical owner and guarded RPC while the database forces actor and version", async () => {
    const supabaseClient = client();
    mocks.authenticate.mockResolvedValue({
      user: { id: "co-owner-1" },
      effectiveOwnerId: "owner-1",
      supabaseClient,
    });
    const response = await POST(request(), { params });
    expect(response.status).toBe(200);
    expect(supabaseClient.rpc).toHaveBeenCalledWith(
      "append_private_financing_servicing_policy_version",
      {
        p_owner_id: "owner-1",
        p_account_id: "pf_acct_1",
        p_payment_acceptance_policy: "full_amount_or_more",
        p_effective_at: future,
        p_reason: "Require the full scheduled amount",
      },
    );
    const sent = supabaseClient.rpc.mock.calls[0][1];
    expect(sent).not.toHaveProperty("p_acting_seller_id");
    expect(sent).not.toHaveProperty("p_version");
  });

  it.each(["partial_allowed", "full_amount_or_more", "exact_amount_only"])(
    "accepts closed policy value %s",
    async (paymentAcceptancePolicy) => {
      mocks.authenticate.mockResolvedValue({
        user: { id: "owner-1" },
        effectiveOwnerId: "owner-1",
        supabaseClient: client(),
      });
      expect((await POST(request({ paymentAcceptancePolicy }), { params })).status).toBe(200);
    },
  );

  it("rejects unknown policy values before calling the RPC", async () => {
    const supabaseClient = client();
    mocks.authenticate.mockResolvedValue({
      user: { id: "owner-1" },
      effectiveOwnerId: "owner-1",
      supabaseClient,
    });
    const response = await POST(request({ paymentAcceptancePolicy: "sometimes" }), { params });
    expect(response.status).toBe(400);
    expect(supabaseClient.rpc).not.toHaveBeenCalled();
  });

  it("requires a reason for every change", async () => {
    const supabaseClient = client();
    mocks.authenticate.mockResolvedValue({
      user: { id: "owner-1" },
      effectiveOwnerId: "owner-1",
      supabaseClient,
    });
    const response = await POST(request({ reason: " " }), { params });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("private_financing_policy_reason_required");
    expect(supabaseClient.rpc).not.toHaveBeenCalled();
  });

  it("rejects retroactive policy changes", async () => {
    const supabaseClient = client();
    mocks.authenticate.mockResolvedValue({
      user: { id: "owner-1" },
      effectiveOwnerId: "owner-1",
      supabaseClient,
    });
    const response = await POST(request({ effectiveAt: "2020-01-01T00:00:00.000Z" }), { params });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("private_financing_policy_backdating_not_allowed");
  });

  it("maps a database workspace denial to 403", async () => {
    mocks.authenticate.mockResolvedValue({
      user: { id: "borrower-1" },
      effectiveOwnerId: "borrower-1",
      supabaseClient: client({ error: { code: "42501" } }),
    });
    expect((await POST(request(), { params })).status).toBe(403);
  });

  it("returns the authentication response without calling the RPC", async () => {
    mocks.authenticate.mockResolvedValue({
      response: Response.json({ error: "sign in" }, { status: 401 }),
    });
    expect((await POST(request(), { params })).status).toBe(401);
  });

  it("maps the new immutable policy version for the UI", async () => {
    mocks.authenticate.mockResolvedValue({
      user: { id: "co-owner-1" },
      effectiveOwnerId: "owner-1",
      supabaseClient: client(),
    });
    const payload = await (await POST(request(), { params })).json();
    expect(payload.servicingPolicy).toMatchObject({
      version: 2,
      paymentAcceptancePolicy: "full_amount_or_more",
      actingSellerId: "co-owner-1",
    });
  });
});
