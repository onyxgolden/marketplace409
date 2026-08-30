import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock("@/lib/supabase/createAuthenticatedPrivateFinancingApplication", () => ({
  createAuthenticatedPrivateFinancingApplication: mocks.authenticate,
}));

import { POST } from "./route";
import { encodeAdjustmentPreviewToken } from "@/domains/private-financing/adjustmentPreviewToken";

const params = Promise.resolve({ accountId: "pf_acct_1" });

function req(body) {
  return new Request("https://test/api/private-financing/accounts/pf_acct_1/adjustments/confirm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const openEventRow = {
  id: "pf_evt_open", owner_id: "owner-1", account_id: "pf_acct_1", event_type: "account_opened",
  event_origin: "interactive_user", created_by: "owner-1", ledger_sequence: 1, effective_date: "2022-03-23",
  recorded_at: "2022-03-23T00:00:00Z",
};
const componentVersionRows = [
  { owner_id: "owner-1", id: "pf_comp_1", account_id: "pf_acct_1", component_key: "ib", label: "Interest-bearing note", original_principal_cents: 4_500_000, rate_bps: 300, day_count_convention: "actual_365", scheduled_component_amount_cents: 43_452, allocation_priority: 1, effective_date: "2022-03-23", version_number: 1 },
  { owner_id: "owner-1", id: "pf_comp_2", account_id: "pf_acct_1", component_key: "zi", label: "Zero-interest note", original_principal_cents: 1_000_000, rate_bps: 0, day_count_convention: "actual_365", scheduled_component_amount_cents: 8_333, allocation_priority: 2, effective_date: "2022-03-23", version_number: 1 },
];
const termsVersionRows = [
  {
    owner_id: "owner-1", id: "pf_terms_1", account_id: "pf_acct_1", version_number: 1, payment_frequency: "monthly",
    first_payment_due_date: "2022-04-23", regular_scheduled_payment_amount_cents: 51_785, maturity_date: null,
    allocation_policy: "scheduled_component_order", extra_payment_allocation_policy: "highest_rate_first_extra",
    prepayment_policy: "allowed_without_penalty_does_not_advance_due_date", day_count_convention: "actual_365",
    effective_date: "2022-03-23", acting_seller_id: "owner-1", amendment_reason: null,
  },
];
const inputs = { componentId: "zi", deltaCents: -1000, reason: "typo" };
const actionType = "contractual_principal_correction";

function buildClient({
  account = { id: "pf_acct_1" },
  accountError = null,
  events = [openEventRow],
  componentVersions = componentVersionRows,
  termsVersions = termsVersionRows,
  rpcResult = { data: { id: "pf_evt_new", event_type: "principal_correction", ledger_sequence: 2, effective_date: "2026-08-30", recorded_at: "2026-08-30T00:00:00Z", amount_cents: null, reason: "typo" }, error: null },
} = {}) {
  function chain(data, error = null) {
    const query = {
      select: () => query,
      eq: () => query,
      order: () => Promise.resolve({ data, error }),
      maybeSingle: () => Promise.resolve({ data, error }),
      then: (resolve) => resolve({ data, error }),
    };
    return query;
  }
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  return {
    from: vi.fn((table) => {
      if (table === "private_financing_accounts") return chain(account, accountError);
      if (table === "private_financing_events") return chain(events);
      if (table === "private_financing_components") return chain(componentVersions);
      if (table === "private_financing_account_terms_versions") return chain(termsVersions);
      throw new Error(`Unexpected table: ${table}`);
    }),
    rpc,
  };
}

function freshToken(overrides = {}) {
  return encodeAdjustmentPreviewToken({
    accountId: "pf_acct_1",
    actionType,
    inputs,
    ledgerSequenceAtPreview: 1, // matches openEventRow's own ledger_sequence -- the current max
    asOfDate: "2026-08-30",
    ...overrides,
  });
}

describe("POST /api/private-financing/accounts/[accountId]/adjustments/confirm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("posts a valid, fresh preview and returns a receipt identifying the newly posted event", async () => {
    const client = buildClient();
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: client });

    const response = await POST(req({ actionType, inputs, previewToken: freshToken() }), { params });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.event.id).toBe("pf_evt_new");
    expect(body.event.eventType).toBe("principal_correction");
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it("posts successfully as a co-owner -- the RPC receives effectiveOwnerId (the canonical workspace owner), not the acting co-owner's own id", async () => {
    const client = buildClient();
    mocks.authenticate.mockResolvedValue({ user: { id: "co-owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: client });

    const response = await POST(req({ actionType, inputs, previewToken: freshToken() }), { params });
    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith("append_private_financing_event", expect.objectContaining({ p_owner_id: "owner-1" }));
  });

  it("never sends p_created_by, p_event_origin other than interactive_user, or a client-suppliable p_owner_id -- the RPC call is fully attribution-locked", async () => {
    const client = buildClient();
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: client });

    await POST(req({ actionType, inputs, previewToken: freshToken() }), { params });
    const rpcCallParams = client.rpc.mock.calls[0][1];
    expect(Object.prototype.hasOwnProperty.call(rpcCallParams, "p_created_by")).toBe(false);
    expect(rpcCallParams.p_event_origin).toBe("interactive_user");
    expect(rpcCallParams.p_owner_id).toBe("owner-1");
  });

  it("rejects a stale preview when the ledger sequence has moved since preview (a new event posted)", async () => {
    const client = buildClient({ events: [openEventRow, { ...openEventRow, id: "pf_evt_2", ledger_sequence: 2 }] }); // current max is now 2
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: client });

    const response = await POST(req({ actionType, inputs, previewToken: freshToken({ ledgerSequenceAtPreview: 1 }) }), { params });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("private_financing_stale_preview");
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("rejects changed adjustment inputs since the preview was computed", async () => {
    const client = buildClient();
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: client });

    const response = await POST(req({ actionType, inputs: { ...inputs, deltaCents: -99999 }, previewToken: freshToken() }), { params });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("private_financing_stale_preview");
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("rejects a preview token issued for a different account (cross-account preview reuse)", async () => {
    const client = buildClient();
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: client });

    const response = await POST(req({ actionType, inputs, previewToken: freshToken({ accountId: "pf_acct_OTHER" }) }), { params });
    expect(response.status).toBe(409);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("rejects a malformed/garbage preview token, fails closed", async () => {
    const client = buildClient();
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: client });

    const response = await POST(req({ actionType, inputs, previewToken: "not-a-valid-token!!!" }), { params });
    expect(response.status).toBe(409);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("prevents a duplicate confirm (double-submit) with the same token once the first post has advanced the ledger sequence", async () => {
    const client = buildClient();
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: client });
    const token = freshToken();

    const first = await POST(req({ actionType, inputs, previewToken: token }), { params });
    expect(first.status).toBe(200);

    // Simulate the ledger having advanced: the second attempt's client now reports the new max sequence.
    const clientAfterFirstPost = buildClient({ events: [openEventRow, { ...openEventRow, id: "pf_evt_new", ledger_sequence: 2 }] });
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: clientAfterFirstPost });
    const second = await POST(req({ actionType, inputs, previewToken: token }), { params });
    expect(second.status).toBe(409);
    expect(clientAfterFirstPost.rpc).not.toHaveBeenCalled();
  });

  it("rejects posting when the freshly-recomputed preview is invalid (e.g. principal would go negative)", async () => {
    const client = buildClient();
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: client });
    const badInputs = { componentId: "zi", deltaCents: -99_999_999, reason: "oops" };
    const token = encodeAdjustmentPreviewToken({ accountId: "pf_acct_1", actionType, inputs: badInputs, ledgerSequenceAtPreview: 1, asOfDate: "2026-08-30" });

    const response = await POST(req({ actionType, inputs: badInputs, previewToken: token }), { params });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("private_financing_validation_failed");
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("rejects duplicate reversal (compensating-correction-style already-reversed target) at the fresh-preview validation step", async () => {
    const alreadyReversedEvent = { ...openEventRow };
    const correction = {
      id: "evt_correction", owner_id: "owner-1", account_id: "pf_acct_1", event_type: "principal_correction",
      event_origin: "interactive_user", created_by: "owner-1", ledger_sequence: 2, effective_date: "2022-04-01",
      recorded_at: "2022-04-01T00:00:00Z", reason: "wrong amount", component_id: "zi",
      correction_basis: "contractual_administrative", delta_cents: -2000, corrected_component_principal_remaining_cents_after: 998_000,
    };
    const firstReversal = {
      id: "evt_first_reversal", owner_id: "owner-1", account_id: "pf_acct_1", event_type: "compensating_correction",
      event_origin: "interactive_user", created_by: "owner-1", reverses_event_id: "evt_correction",
      component_id: "zi", delta_cents: 2000, reason: "undo it", effective_date: "2022-04-02",
      ledger_sequence: 3, recorded_at: "2022-04-02T00:00:00Z",
    };
    const client = buildClient({ events: [alreadyReversedEvent, correction, firstReversal] });
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: client });

    const compInputs = { reversesEventId: "evt_correction", deltaCents: 2000, reason: "undo again" };
    const token = encodeAdjustmentPreviewToken({ accountId: "pf_acct_1", actionType: "compensating_correction", inputs: compInputs, ledgerSequenceAtPreview: 3, asOfDate: "2026-08-30" });
    const response = await POST(req({ actionType: "compensating_correction", inputs: compInputs, previewToken: token }), { params });
    expect(response.status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing or inaccessible account -- no side-channel detail (covers unrelated-workspace: the account simply isn't visible)", async () => {
    const client = buildClient({ account: null });
    mocks.authenticate.mockResolvedValue({ user: { id: "unrelated-user" }, effectiveOwnerId: "unrelated-user", supabaseClient: client });
    const response = await POST(req({ actionType, inputs, previewToken: freshToken() }), { params });
    expect(response.status).toBe(404);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("returns 503 with a stable code when the schema doesn't exist remotely yet", async () => {
    const client = buildClient({ account: null, accountError: { code: "42P01", message: "relation does not exist" } });
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: client });
    const response = await POST(req({ actionType, inputs, previewToken: freshToken() }), { params });
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("private_financing_schema_unavailable");
  });

  it("returns a safe 500 when the RPC itself fails, never leaking raw database details", async () => {
    const client = buildClient({ rpcResult: { data: null, error: { code: "XX000", message: "internal postgres detail nobody should see" } } });
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: client });
    const response = await POST(req({ actionType, inputs, previewToken: freshToken() }), { params });
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain("internal postgres detail");
  });

  it("propagates the 401 response from the auth factory unchanged -- covers borrower/unauthenticated denial at the boundary", async () => {
    mocks.authenticate.mockResolvedValue({ response: new Response(JSON.stringify({ error: "Authenticated owner id is required." }), { status: 401 }) });
    const response = await POST(req({ actionType, inputs, previewToken: freshToken() }), { params });
    expect(response.status).toBe(401);
  });

  it("rejects an unrecognized action type before ever decoding the token or touching the database", async () => {
    const client = buildClient();
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: client });
    const response = await POST(req({ actionType: "not_a_real_action", inputs, previewToken: freshToken() }), { params });
    expect(response.status).toBe(400);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("accepts an optional seller-only internalNote and forwards it to the RPC, trimmed", async () => {
    const client = buildClient();
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: client });
    await POST(req({ actionType, inputs, previewToken: freshToken(), internalNote: "  seller-only detail  " }), { params });
    expect(client.rpc).toHaveBeenCalledWith("append_private_financing_event", expect.objectContaining({ p_internal_note: "seller-only detail" }));
  });
});
