import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createPublicScreeningClient", () => ({ createPublicScreeningClient: vi.fn() }));
import { createPublicScreeningClient } from "@/lib/supabase/createPublicScreeningClient";
import { GET, POST } from "./route";

// Service-role stub: reads + rate-limit attempts go through `from()`; the
// consent/info update + both audit events go through the atomic
// record_applicant_screening_info RPC (one transaction).
function makeDb({ screening = null, attempts = [], rpcHandler } = {}) {
  const calls = { insert: [], rpc: [] };
  const chainFor = (table) => {
    const chain = {
      select() { return chain; },
      eq() { return chain; },
      gte() { return chain; },
      order() { return chain; },
      limit() { return chain; },
      insert(payload) { calls.insert.push({ table, payload }); return chain; },
      async maybeSingle() {
        if (table === "rental_application_screenings") return { data: screening, error: null };
        return { data: null, error: null };
      },
      then(resolve) {
        if (table === "rental_screening_public_attempts") resolve({ data: attempts, error: null });
        else resolve({ data: [], error: null });
      },
    };
    return chain;
  };
  const db = {
    from: vi.fn((table) => chainFor(table)),
    rpc: vi.fn(async (name, params) => {
      calls.rpc.push({ name, params });
      if (rpcHandler) return rpcHandler(name, params);
      return { data: { status: "requested", consent_recorded: true, info_received: true }, error: null };
    }),
  };
  return { db, calls };
}

const OPEN = {
  id: "scr_1", owner_id: "owner_1", application_id: "app_1", status: "requested",
  consent_recorded: false, applicant_provided: {},
};
const CLOSED = { ...OPEN, status: "complete", consent_recorded: true, applicant_provided: { phone: "555-0100" } };

const req = (method, body, headers = {}) => new Request("https://t/", {
  method,
  headers: { "x-forwarded-for": "203.0.113.7", ...headers },
  body: body ? JSON.stringify(body) : undefined,
});
const params = { params: Promise.resolve({ token: "tok123456789012345678901" }) };

function publicAs(db) {
  createPublicScreeningClient.mockReturnValue(db);
}

beforeEach(() => { vi.clearAllMocks(); });

describe("public screening link GET", () => {
  it("404s on a guessed/unknown token", async () => {
    const { db } = makeDb({ screening: null });
    publicAs(db);
    const res = await GET(req("GET"), params);
    expect(res.status).toBe(404);
  });
  it("429s when the token+IP is rate-limited", async () => {
    const attempts = Array.from({ length: 15 }, () => ({ attempted_at: new Date().toISOString() }));
    const { db } = makeDb({ screening: OPEN, attempts });
    publicAs(db);
    const res = await GET(req("GET"), params);
    expect(res.status).toBe(429);
  });
  it("returns minimal link state for a valid token", async () => {
    const { db } = makeDb({ screening: OPEN, attempts: [] });
    publicAs(db);
    const res = await GET(req("GET"), params);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.status).toBe("requested");
    expect(data.acceptsSubmissions).toBe(true);
    // Never leaks owner results or notes.
    expect(data.creditScore).toBeUndefined();
    expect(data.criminalNotes).toBeUndefined();
  });
});

describe("public screening link POST", () => {
  it("404s on a guessed/unknown token", async () => {
    const { db } = makeDb({ screening: null });
    publicAs(db);
    const res = await POST(req("POST", { consent: true }), params);
    expect(res.status).toBe(404);
  });
  it("429s when rate-limited", async () => {
    const attempts = Array.from({ length: 15 }, () => ({ attempted_at: new Date().toISOString() }));
    const { db } = makeDb({ screening: OPEN, attempts });
    publicAs(db);
    const res = await POST(req("POST", { consent: true }), params);
    expect(res.status).toBe(429);
  });
  it("400s without consent (fail closed)", async () => {
    const { db } = makeDb({ screening: OPEN, attempts: [] });
    publicAs(db);
    const res = await POST(req("POST", { fullName: "Jane Doe" }), params);
    expect(res.status).toBe(400);
  });
  it("410s on a closed screening", async () => {
    const { db } = makeDb({ screening: CLOSED, attempts: [] });
    publicAs(db);
    const res = await POST(req("POST", { consent: true }), params);
    expect(res.status).toBe(410);
  });
  it("records consent + info through the atomic RPC (one transaction)", async () => {
    const { db, calls } = makeDb({ screening: OPEN, attempts: [] });
    publicAs(db);
    const res = await POST(req("POST", {
      consent: true, consentText: "I agree to screening.",
      fullName: "Jane Doe", phone: "555-0100", dateOfBirth: "1990-05-01", ssnLast4: "1234",
    }), params);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.infoReceived).toBe(true);
    // Exactly one DB write for the consent transition: the RPC. The consent
    // update and both audit events commit in one transaction — consent can
    // never be recorded without its audit trail.
    expect(calls.rpc).toHaveLength(1);
    const call = calls.rpc[0];
    expect(call.name).toBe("record_applicant_screening_info");
    expect(call.params.p_token).toBe("tok123456789012345678901");
    expect(call.params.p_consent_text).toBe("I agree to screening.");
    expect(call.params.p_applicant_provided).toMatchObject({ fullName: "Jane Doe", ssnLast4: "1234" });
    // No split mutation/event writes: the only inserts are rate-limit attempts.
    for (const insert of calls.insert) {
      expect(insert.table).toBe("rental_screening_public_attempts");
    }
  });
  it("404s when the RPC reports an unknown token (lost race)", async () => {
    const { db } = makeDb({
      screening: OPEN, attempts: [],
      rpcHandler: () => ({ data: null, error: { message: "SCREENING_NOT_FOUND: this screening link is not valid." } }),
    });
    publicAs(db);
    const res = await POST(req("POST", { consent: true }), params);
    expect(res.status).toBe(404);
  });
  it("410s when the RPC reports a closed screening (lost race)", async () => {
    const { db } = makeDb({
      screening: OPEN, attempts: [],
      rpcHandler: () => ({ data: null, error: { message: "SCREENING_CLOSED: this screening is closed." } }),
    });
    publicAs(db);
    const res = await POST(req("POST", { consent: true }), params);
    expect(res.status).toBe(410);
  });
  it("500s on a genuine RPC failure (audit append fails = whole transaction fails)", async () => {
    const { db } = makeDb({
      screening: OPEN, attempts: [],
      rpcHandler: () => { throw new Error("event insert failed"); },
    });
    publicAs(db);
    const res = await POST(req("POST", { consent: true }), params);
    expect(res.status).toBe(500);
  });
  it("logs the attempt for rate limiting", async () => {
    const { db, calls } = makeDb({ screening: OPEN, attempts: [] });
    publicAs(db);
    await GET(req("GET"), params);
    expect(calls.insert.some((c) => c.table === "rental_screening_public_attempts")).toBe(true);
  });
});
