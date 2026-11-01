import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
vi.mock("@/lib/supabase/isOwnerOrActiveCoOwner", () => ({ isOwnerOrActiveCoOwner: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { isOwnerOrActiveCoOwner } from "@/lib/supabase/isOwnerOrActiveCoOwner";
import { PATCH } from "./route";

// Controls-sweep follow-up G21 (O-10): reopen a completed screening.
const APP = { id: "app_1", listing_id: "listing_1", status: "pending", answers: { consent: true } };
const COMPLETE = {
  id: "scr_1", application_id: "app_1", status: "complete", screening_token: "tok123456789012345678901",
  consent_verified_on_application: true, consent_recorded: true, consent_recorded_at: "2026-10-01T00:00:00Z",
  requested_by: "user_1", requested_at: "2026-10-01T00:00:00Z", provider_status: "not_connected", provider_key: null,
  credit_score: 720, credit_band: "good", criminal_flag: false, criminal_notes: null,
  eviction_flag: false, eviction_notes: null, applicant_provided: {},
  recommendation: "approve", recommendation_reasons: null,
  results_recorded_by: "user_1", results_recorded_at: "2026-10-01T00:00:00Z",
  completed_by: "user_1", completed_at: "2026-10-01T00:00:00Z",
  created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
};

function makeDb({ screening = COMPLETE, rpcHandler } = {}) {
  const calls = [];
  const chainFor = (table) => {
    const chain = {
      select() { return chain; }, eq() { return chain; }, order() { return chain; }, limit() { return chain; },
      async maybeSingle() {
        if (table === "rental_applications") return { data: APP, error: null };
        if (table === "rental_application_screenings") return { data: screening, error: null };
        return { data: null, error: null };
      },
      then(resolve) { resolve({ data: [], error: null }); },
    };
    return chain;
  };
  return {
    calls,
    from: (table) => chainFor(table),
    rpc: async (name, params) => {
      calls.push({ name, params });
      if (rpcHandler) return rpcHandler(name, params);
      if (name === "transition_screening" && params.p_action === "reopen") {
        return { data: { ...COMPLETE, status: "in_progress", completed_by: null, completed_at: null }, error: null };
      }
      return { data: null, error: null };
    },
  };
}

function authAs(db, owner = true) {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user_1" }, effectiveOwnerId: "owner_1", supabaseClient: db,
  });
  isOwnerOrActiveCoOwner.mockResolvedValue(owner);
}

const req = (body) => new Request("https://t/", { method: "PATCH", body: JSON.stringify(body) });
const params = { params: Promise.resolve({ id: "app_1" }) };

describe("screening PATCH reopen follow-up G21", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("O-10: reopens a completed screening to in_progress with the reason", async () => {
    const db = makeDb({});
    authAs(db);
    const res = await PATCH(req({ action: "reopen", reason: "Wrong score typed" }), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.screening.status).toBe("in_progress");
    expect(body.screening.completedBy).toBeNull();
    expect(db.calls[0].params.p_action).toBe("reopen");
    expect(db.calls[0].params.p_payload.reason).toBe("Wrong score typed");
  });

  it("O-10: 409s when the screening is not complete", async () => {
    const db = makeDb({ screening: { ...COMPLETE, status: "in_progress" } });
    authAs(db);
    const res = await PATCH(req({ action: "reopen" }), params);
    expect(res.status).toBe(409);
    expect(db.calls).toHaveLength(0);
  });

  it("O-10: pre-migration unknown-action maps to a plain 503, screening untouched", async () => {
    const db = makeDb({
      rpcHandler: () => ({ data: null, error: { message: "SCREENING_INVALID: unknown screening action." } }),
    });
    authAs(db);
    const res = await PATCH(req({ action: "reopen" }), params);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("has not been applied yet");
  });

  it("O-10: staff cannot reopen", async () => {
    const db = makeDb({});
    authAs(db, false);
    const res = await PATCH(req({ action: "reopen" }), params);
    expect(res.status).toBe(403);
  });
});
