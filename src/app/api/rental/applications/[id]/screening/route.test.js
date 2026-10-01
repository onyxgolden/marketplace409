import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
vi.mock("@/lib/supabase/isOwnerOrActiveCoOwner", () => ({ isOwnerOrActiveCoOwner: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { isOwnerOrActiveCoOwner } from "@/lib/supabase/isOwnerOrActiveCoOwner";
import { GET, POST, PATCH } from "./route";

// Chainable supabase stub. Reads still go through `from()`; every screening
// state mutation + audit event goes through `rpc()` — the atomic RPCs in
// 20261001143000_rental_screening_atomic_transitions.sql. The default
// rpcHandler simulates the transaction; tests override it to simulate
// failures/races.
function makeDb({ application, screening, events = [], rpcHandler } = {}) {
  const calls = { from: [], rpc: [] };
  const canned = {
    rental_applications: { one: application ?? null },
    rental_application_screenings: { one: screening ?? null },
    rental_screening_events: { list: events },
  };
  const chainFor = (table) => {
    const result = canned[table] || {};
    const chain = {
      select() { return chain; },
      eq() { return chain; },
      order() { return chain; },
      limit() { return chain; },
      async maybeSingle() { return { data: result.one ?? null, error: null }; },
      then(resolve) { resolve({ data: result.list ?? [], error: null }); },
    };
    return chain;
  };
  const defaultRpc = (name, params) => {
    if (name === "request_screening") {
      return { data: { ...SCREENING, id: "scr_new", screening_token: params.p_token, status: "requested" }, error: null };
    }
    if (name === "transition_screening") {
      const action = params.p_action;
      if (action === "mark_in_progress") return { data: { ...SCREENING, status: "in_progress" }, error: null };
      if (action === "record_results") return { data: { ...SCREENING, credit_score: 720, results_recorded_at: "2026-10-01T00:00:00Z" }, error: null };
      if (action === "set_recommendation") return { data: { ...SCREENING, recommendation: params.p_payload?.recommendation ?? null }, error: null };
      if (action === "complete") return { data: { ...SCREENING, status: "complete", completed_by: "user_1" }, error: null };
      if (action === "regenerate_token") return { data: { ...SCREENING, screening_token: params.p_payload?.token }, error: null };
      if (action === "provider_attempt_blocked") return { data: { ...SCREENING }, error: null };
    }
    return { data: null, error: null };
  };
  const db = {
    from: vi.fn((table) => { calls.from.push(table); return chainFor(table); }),
    rpc: vi.fn(async (name, params) => {
      calls.rpc.push({ name, params });
      return (rpcHandler || defaultRpc)(name, params);
    }),
  };
  return { db, calls };
}

const APP = { id: "app_1", listing_id: "listing_1", status: "pending", answers: { consent: true } };
const APP_NO_CONSENT = { ...APP, answers: {} };
const SCREENING = {
  id: "scr_1", application_id: "app_1", status: "requested", screening_token: "tok123456789012345678901",
  consent_verified_on_application: true, consent_recorded: true, consent_recorded_at: "2026-10-01T00:00:00Z",
  requested_by: "user_1", requested_at: "2026-10-01T00:00:00Z", provider_status: "not_connected", provider_key: null,
  credit_score: null, credit_band: null, criminal_flag: false, criminal_notes: null,
  eviction_flag: false, eviction_notes: null, applicant_provided: {},
  recommendation: null, recommendation_reasons: null,
  results_recorded_by: null, results_recorded_at: null, completed_by: null, completed_at: null,
  created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
};

const req = (method, body) => new Request("https://t/", { method, body: body ? JSON.stringify(body) : undefined });
const params = { params: Promise.resolve({ id: "app_1" }) };

// R22 authz: screening writes are owner/co-owner only. The isOwnerOrActiveCoOwner
// mock answers the boundary directly (primary owner or active co_owner =
// allowed; manager/bookkeeper/read_only staff = denied).
function authAs(db, ownerOrCoOwner = true) {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user_1" }, effectiveOwnerId: "owner_1", supabaseClient: db,
  });
  isOwnerOrActiveCoOwner.mockResolvedValue(ownerOrCoOwner);
}

beforeEach(() => { vi.clearAllMocks(); });

describe("screening GET (owner view)", () => {
  it("returns the screening, events, and the gated provider catalog", async () => {
    const { db } = makeDb({ application: APP, screening: SCREENING, events: [{ id: "e1" }] });
    authAs(db);
    const res = await GET(req("GET"), params);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.screening.id).toBe("scr_1");
    expect(data.events).toHaveLength(1);
    expect(data.providers.length).toBeGreaterThan(0);
    for (const provider of data.providers) {
      expect(provider.status).toBe("not_connected");
      expect(provider.pulled).toBe(false);
    }
  });
  it("returns a null screening when none was requested", async () => {
    const { db } = makeDb({ application: APP, screening: null });
    authAs(db);
    const res = await GET(req("GET"), params);
    expect(res.status).toBe(200);
    expect((await res.json()).screening).toBeNull();
  });
  it("404s for an unknown application", async () => {
    const { db } = makeDb({ application: null });
    authAs(db);
    const res = await GET(req("GET"), params);
    expect(res.status).toBe(404);
  });
});

describe("screening write authz (finding 3: owner/co-owner boundary)", () => {
  it("403s POST for staff (not owner/co-owner)", async () => {
    const { db } = makeDb({ application: APP });
    authAs(db, false);
    const res = await POST(req("POST"), params);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/owner or co-owner/i);
  });
  it("403s PATCH for staff (not owner/co-owner)", async () => {
    const { db } = makeDb({ application: APP, screening: SCREENING });
    authAs(db, false);
    const res = await PATCH(req("PATCH", { action: "mark_in_progress" }), params);
    expect(res.status).toBe(403);
  });
  it("staff cannot reach the RPC at all", async () => {
    const { db, calls } = makeDb({ application: APP, screening: SCREENING });
    authAs(db, false);
    await PATCH(req("PATCH", { action: "mark_in_progress" }), params);
    expect(calls.rpc).toHaveLength(0);
  });
  it("owner/co-owner writes are allowed", async () => {
    const { db, calls } = makeDb({ application: APP, screening: SCREENING });
    authAs(db, true);
    const res = await PATCH(req("PATCH", { action: "mark_in_progress" }), params);
    expect(res.status).toBe(200);
    expect(calls.rpc.some((c) => c.name === "transition_screening")).toBe(true);
  });
});

describe("screening POST (request)", () => {
  it("fails closed without recorded applicant consent (409)", async () => {
    const { db } = makeDb({ application: APP_NO_CONSENT, screening: null });
    authAs(db);
    const res = await POST(req("POST"), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/consent/i);
  });
  it("accepts consent re-confirmed through the applicant link", async () => {
    const prior = { ...SCREENING, status: "complete" };
    const { db, calls } = makeDb({ application: APP_NO_CONSENT, screening: prior });
    authAs(db);
    const res = await POST(req("POST"), params);
    expect(res.status).toBe(201);
    expect(calls.rpc.some((c) => c.name === "request_screening")).toBe(true);
  });
  it("409s when a screening is already open", async () => {
    const { db } = makeDb({ application: APP, screening: SCREENING });
    authAs(db);
    const res = await POST(req("POST"), params);
    expect(res.status).toBe(409);
  });
  it("409s on a non-pending application", async () => {
    const { db } = makeDb({ application: { ...APP, status: "approved" } });
    authAs(db);
    const res = await POST(req("POST"), params);
    expect(res.status).toBe(409);
  });
  it("creates the screening with a token and returns the applicant link", async () => {
    const { db, calls } = makeDb({ application: APP, screening: null });
    authAs(db);
    const res = await POST(req("POST"), params);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.screening.token).toMatch(/^[A-Za-z0-9]{24}$/);
    expect(data.applicantLink).toMatch(/\/rentals\/screening\//);
    const call = calls.rpc.find((c) => c.name === "request_screening");
    expect(call).toBeTruthy();
    expect(call.params.p_application_id).toBe("app_1");
    expect(call.params.p_owner_id).toBe("owner_1");
    expect(call.params.p_token).toMatch(/^[A-Za-z0-9]{24}$/);
    expect(call.params.p_consent_recorded).toBe(true);
  });
  it("409s on a lost race (RPC SCREENING_CONFLICT)", async () => {
    const { db } = makeDb({
      application: APP, screening: null,
      rpcHandler: () => ({ data: null, error: { message: "SCREENING_CONFLICT: a screening is already open on this application." } }),
    });
    authAs(db);
    const res = await POST(req("POST"), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already open/);
  });
});

describe("screening PATCH", () => {
  it("marks in_progress on a valid transition", async () => {
    const { db, calls } = makeDb({ application: APP, screening: SCREENING });
    authAs(db);
    const res = await PATCH(req("PATCH", { action: "mark_in_progress" }), params);
    expect(res.status).toBe(200);
    const call = calls.rpc.find((c) => c.name === "transition_screening");
    expect(call.params.p_action).toBe("mark_in_progress");
    expect(call.params.p_screening_id).toBe("scr_1");
    expect((await res.json()).screening.status).toBe("in_progress");
  });
  it("409s on an invalid transition", async () => {
    const { db } = makeDb({ application: APP, screening: { ...SCREENING, status: "complete" } });
    authAs(db);
    const res = await PATCH(req("PATCH", { action: "mark_in_progress" }), params);
    expect(res.status).toBe(409);
  });
  it("400s on invalid manual results", async () => {
    const { db } = makeDb({ application: APP, screening: SCREENING });
    authAs(db);
    const res = await PATCH(req("PATCH", { action: "record_results", results: { creditScore: 999 } }), params);
    expect(res.status).toBe(400);
  });
  it("records valid manual results", async () => {
    const { db, calls } = makeDb({ application: APP, screening: SCREENING });
    authAs(db);
    const res = await PATCH(req("PATCH", {
      action: "record_results",
      results: { creditScore: 720, creditBand: "good", criminalFlag: false, evictionFlag: false, evictionNotes: "none" },
    }), params);
    expect(res.status).toBe(200);
    const call = calls.rpc.find((c) => c.name === "transition_screening");
    expect(call.params.p_action).toBe("record_results");
    expect(call.params.p_payload.credit_score).toBe(720);
    expect(call.params.p_payload.credit_band).toBe("good");
  });
  it("409s on complete with no results recorded (fail closed)", async () => {
    const { db } = makeDb({ application: APP, screening: SCREENING });
    authAs(db);
    const res = await PATCH(req("PATCH", { action: "complete" }), params);
    expect(res.status).toBe(409);
  });
  it("completes when results exist", async () => {
    const withResults = { ...SCREENING, credit_score: 700 };
    const { db } = makeDb({ application: APP, screening: withResults });
    authAs(db);
    const res = await PATCH(req("PATCH", { action: "complete" }), params);
    expect(res.status).toBe(200);
    expect((await res.json()).screening.status).toBe("complete");
  });
  it("completes when explicit 'no flags' results were recorded (finding 2)", async () => {
    // criminalFlag=false, evictionFlag=false with nothing else recorded is
    // still a recorded result — results_recorded_at is the source of truth.
    const explicitNegatives = {
      ...SCREENING, criminal_flag: false, eviction_flag: false,
      results_recorded_at: "2026-10-01T00:00:00Z", results_recorded_by: "user_1",
    };
    const { db } = makeDb({ application: APP, screening: explicitNegatives });
    authAs(db);
    const res = await PATCH(req("PATCH", { action: "complete" }), params);
    expect(res.status).toBe(200);
  });
  it("regenerates the token and returns the new applicant link", async () => {
    const { db, calls } = makeDb({ application: APP, screening: SCREENING });
    authAs(db);
    const res = await PATCH(req("PATCH", { action: "regenerate_token" }), params);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.applicantLink).toMatch(/\/rentals\/screening\//);
    const call = calls.rpc.find((c) => c.name === "transition_screening");
    expect(call.params.p_action).toBe("regenerate_token");
    expect(call.params.p_payload.token).toMatch(/^[A-Za-z0-9]{24}$/);
  });
  it("request_provider_report is always 501 not_connected and audited (provider gate)", async () => {
    const { db, calls } = makeDb({ application: APP, screening: SCREENING });
    authAs(db);
    const res = await PATCH(req("PATCH", { action: "request_provider_report", providerKey: "transunion" }), params);
    expect(res.status).toBe(501);
    const data = await res.json();
    expect(data.status).toBe("not_connected");
    expect(data.pulled).toBe(false);
    const call = calls.rpc.find((c) => c.name === "transition_screening");
    expect(call.params.p_action).toBe("provider_attempt_blocked");
    expect(call.params.p_payload.provider_key).toBe("transunion");
  });
  it("request_provider_report is 501 even for unknown providers", async () => {
    const { db } = makeDb({ application: APP, screening: SCREENING });
    authAs(db);
    const res = await PATCH(req("PATCH", { action: "request_provider_report", providerKey: "nope" }), params);
    expect(res.status).toBe(501);
    expect((await res.json()).pulled).toBe(false);
  });
  it("400s on an unknown action", async () => {
    const { db } = makeDb({ application: APP, screening: SCREENING });
    authAs(db);
    const res = await PATCH(req("PATCH", { action: "launch" }), params);
    expect(res.status).toBe(400);
  });
  it("409s when the RPC reports a state conflict (lost race)", async () => {
    const { db } = makeDb({
      application: APP, screening: SCREENING,
      rpcHandler: () => ({ data: null, error: { message: "SCREENING_CONFLICT: cannot complete a \"complete\" screening." } }),
    });
    authAs(db);
    const res = await PATCH(req("PATCH", { action: "mark_in_progress" }), params);
    expect(res.status).toBe(409);
  });
  it("500s on a genuine RPC failure", async () => {
    const { db } = makeDb({
      application: APP, screening: SCREENING,
      rpcHandler: () => ({ data: null, error: { message: "connection failure" } }),
    });
    authAs(db);
    const res = await PATCH(req("PATCH", { action: "mark_in_progress" }), params);
    expect(res.status).toBe(500);
  });
});

describe("screening audit atomicity (finding 1: single-transaction transitions)", () => {
  // Every state transition is exactly ONE rpc() call. A failed audit append
  // fails the whole transaction inside the RPC — the route can never
  // half-commit a screening mutation without its event, because it never
  // performs the mutation and the event as separate requests.
  it("performs every transition as a single atomic RPC — no split mutation/event writes", async () => {
    const { db: postDb, calls: postCalls } = makeDb({ application: APP, screening: null });
    authAs(postDb);
    const postRes = await POST(req("POST"), params);
    expect(postRes.status).toBe(201);
    const { db: patchDb, calls: patchCalls } = makeDb({ application: APP, screening: SCREENING });
    authAs(patchDb);
    await PATCH(req("PATCH", { action: "mark_in_progress" }), params);
    await PATCH(req("PATCH", { action: "record_results", results: { creditScore: 700 } }), params);
    await PATCH(req("PATCH", { action: "set_recommendation", recommendationInput: { recommendation: "approve", reasons: "clean" } }), params);
    await PATCH(req("PATCH", { action: "regenerate_token" }), params);
    const names = [...postCalls.rpc, ...patchCalls.rpc].map((c) => c.name);
    expect(names).toEqual([
      "request_screening", "transition_screening", "transition_screening",
      "transition_screening", "transition_screening",
    ]);
  });
  it("never writes screenings or audit events outside the RPCs", async () => {
    const { db, calls } = makeDb({ application: APP, screening: SCREENING });
    authAs(db);
    await POST(req("POST"), params);
    await PATCH(req("PATCH", { action: "mark_in_progress" }), params);
    // The only `from()` touches on the screening tables are reads (selects
    // for prechecks / event listing). Inserts and updates happen only inside
    // the RPC transactions. The chain stub records no insert/update calls at
    // all — assert every table touch was a read.
    const touched = calls.from;
    expect(touched).toContain("rental_application_screenings");
    for (const table of touched) {
      expect(["rental_applications", "rental_application_screenings", "rental_screening_events"]).toContain(table);
    }
    // The failure-injection half of the guarantee: an RPC that raises (audit
    // append failing inside the transaction) fails the whole action — the
    // route surfaces 500 and no second request can have committed first.
    const { db: failingDb } = makeDb({
      application: APP, screening: SCREENING,
      rpcHandler: () => { throw new Error("event insert failed"); },
    });
    authAs(failingDb);
    const res = await PATCH(req("PATCH", { action: "mark_in_progress" }), params);
    expect(res.status).toBe(500);
  });
});
