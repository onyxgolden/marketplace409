import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock("@/lib/supabase/createAuthenticatedFinancialApplication", () => ({
  createAuthenticatedFinancialApplication: mocks.authenticate,
}));

import { DEBT_PAYOFF_SUGGESTIONS_PREFERENCE } from "@/domains/ledger/brain/debtPayoff.js";
import { PUT } from "./route";

function buildAuth(upsertResult = { error: null }) {
  const upsert = vi.fn().mockResolvedValue(upsertResult);
  const supabaseClient = {
    from: vi.fn((table) => {
      if (table !== "brain_preferences") throw new Error(`unexpected table ${table}`);
      return { upsert };
    }),
  };
  mocks.authenticate.mockResolvedValue({
    user: { id: "owner_1" },
    effectiveOwnerId: "owner_1",
    supabaseClient,
  });
  return { upsert };
}

function putRequest(body) {
  return new Request("http://localhost/api/financial/debt-payoff/preferences", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PUT /api/financial/debt-payoff/preferences", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stores the opt-out under the owner's preference key", async () => {
    const { upsert } = buildAuth();
    const response = await PUT(putRequest({ suggestionsEnabled: false }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, data: { suggestionsEnabled: false } });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        owner_id: "owner_1",
        preference_key: DEBT_PAYOFF_SUGGESTIONS_PREFERENCE,
        enabled: false,
      }),
      { onConflict: "owner_id,preference_key" },
    );
  });

  it("stores the opt-in the same way", async () => {
    const { upsert } = buildAuth();
    const body = await (await PUT(putRequest({ suggestionsEnabled: true }))).json();
    expect(body.data).toEqual({ suggestionsEnabled: true });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true }),
      expect.anything(),
    );
  });

  it("rejects non-boolean values without writing", async () => {
    const { upsert } = buildAuth();
    for (const body of [{ suggestionsEnabled: "no" }, {}, { suggestionsEnabled: 1 }]) {
      expect((await PUT(putRequest(body))).status).toBe(400);
    }
    expect(upsert).not.toHaveBeenCalled();
  });

  it("returns the authentication response when unauthenticated", async () => {
    mocks.authenticate.mockResolvedValue({ response: new Response("unauthorized", { status: 401 }) });
    expect((await PUT(putRequest({ suggestionsEnabled: false }))).status).toBe(401);
  });
});
