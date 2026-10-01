import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createPublicListingClient", () => ({ createPublicListingClient: vi.fn() }));
import { createPublicListingClient } from "@/lib/supabase/createPublicListingClient";
import { POST } from "./route";

// Public intake rate limiting (R21 CHANGES fix): the route records each
// submission attempt through the atomic record_application_submission_attempt
// RPC — check and record happen in one transaction under an advisory lock, so
// a double-submit race cannot slip two applications past the limit. These
// tests prove the route calls exactly one RPC (no separate
// rental_application_rate_limits select/insert), passes the configured
// window/limit, 429s when the RPC denies, and still short-circuits the
// honeypot before touching the database.

const LISTING_ROW = {
  id: "listing_1", owner_id: "owner_1", title: "Sunny 2-bed",
  public_slug: "abcDEF123456", listing_form_id: null,
};

const ANSWERS = {
  personal: { firstName: "Sam", lastName: "Applicant", email: "sam@example.com", phone: "555-0100" },
  residence: { current: { address: "1 Main St", city: "Beaumont", state: "TX", landlordName: "N/A" } },
  employment: { current: { employerName: "Acme", jobTitle: "Tech" } },
  references: [{ name: "Ref One", phone: "555-0200" }],
  consent: true,
};

function makeDb({ rpcResult = { data: true, error: null }, listingRow = LISTING_ROW } = {}) {
  const rpcCalls = [];
  const calls = { rpc: rpcCalls, insert: [], select: [] };
  const db = {
    rpc: vi.fn(async (name, args) => {
      rpcCalls.push({ name, args });
      return rpcResult;
    }),
    from: vi.fn((name) => {
      calls.select.push(name);
      const table = {
        select() { return table; },
        eq() { return table; },
        gte() { return table; },
        order() { return table; },
        limit() { return table; },
        async maybeSingle() {
          if (name === "rental_listings") return { data: listingRow, error: null };
          if (name === "rental_listing_forms") return { data: null, error: null };
          return { data: null, error: null };
        },
        insert(payload) {
          calls.insert.push({ table: name, payload });
          return table;
        },
        async single() {
          if (calls.insert.some((c) => c.table === name)) {
            return { data: { id: "app_1", submitted_at: "2026-10-01T09:00:00Z" }, error: null };
          }
          return { data: null, error: null };
        },
      };
      return table;
    }),
  };
  return { db, calls };
}

const postApply = (slug, body, headers = {}) => POST(
  new Request(`https://t/${slug}`, {
    method: "POST",
    body: JSON.stringify(body),
    // The platform edge sets x-real-ip; the route trusts only that header
    // for rate-limit bucketing (forged x-forwarded-for prefixes must not
    // change the bucket).
    headers: { "x-real-ip": "203.0.113.7", ...headers },
  }),
  { params: Promise.resolve({ slug }) },
);

describe("public application intake rate limiting", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("records the attempt through one atomic RPC and accepts the application", async () => {
    const { db, calls } = makeDb();
    createPublicListingClient.mockReturnValue(db);
    const response = await postApply("abcDEF123456", { answers: ANSWERS });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.applicationId).toBe("app_1");
    // Exactly one RPC: no separate rate_limits select/insert from the route.
    expect(calls.rpc).toHaveLength(1);
    expect(calls.rpc[0].name).toBe("record_application_submission_attempt");
    expect(calls.rpc[0].args.p_owner_id).toBe("owner_1");
    expect(calls.rpc[0].args.p_listing_id).toBe("listing_1");
    expect(calls.rpc[0].args.p_window_seconds).toBe(3600);
    expect(calls.rpc[0].args.p_max_submissions).toBe(5);
    expect(calls.rpc[0].args.p_ip_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(calls.select).not.toContain("rental_application_rate_limits");
    expect(calls.insert.find((c) => c.table === "rental_application_rate_limits")).toBeUndefined();
    // The application itself is still inserted.
    expect(calls.insert.find((c) => c.table === "rental_applications")).toBeTruthy();
  });

  it("429s when the RPC denies the attempt, without inserting an application", async () => {
    const { db, calls } = makeDb({ rpcResult: { data: false, error: null } });
    createPublicListingClient.mockReturnValue(db);
    const response = await postApply("abcDEF123456", { answers: ANSWERS });
    expect(response.status).toBe(429);
    expect(calls.rpc).toHaveLength(1);
    expect(calls.insert.find((c) => c.table === "rental_applications")).toBeUndefined();
  });

  it("500s when the attempt RPC itself fails", async () => {
    const { db } = makeDb({ rpcResult: { data: null, error: new Error("db down") } });
    createPublicListingClient.mockReturnValue(db);
    const response = await postApply("abcDEF123456", { answers: ANSWERS });
    expect(response.status).toBe(500);
  });

  it("short-circuits the honeypot before recording any attempt", async () => {
    const { db, calls } = makeDb();
    createPublicListingClient.mockReturnValue(db);
    const response = await postApply("abcDEF123456", { answers: ANSWERS, company: "spam-bot" });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(calls.rpc).toHaveLength(0);
    expect(calls.insert).toHaveLength(0);
  });

  it("404s an unpublished listing before recording any attempt", async () => {
    const { db, calls } = makeDb({ listingRow: null });
    createPublicListingClient.mockReturnValue(db);
    const response = await postApply("abcDEF123456", { answers: ANSWERS });
    expect(response.status).toBe(404);
    expect(calls.rpc).toHaveLength(0);
  });

  it("ignores a forged x-forwarded-for prefix: the bucket follows x-real-ip only", async () => {
    // R21 CHANGES regression: the first x-forwarded-for element is
    // client-supplied, so a client rotating a forged prefix must NOT get a
    // fresh rate-limit bucket. The hash must equal the x-real-ip-only hash.
    const { createHash } = await import("node:crypto");
    const expected = createHash("sha256").update("r21-application:203.0.113.7").digest("hex");
    const { db, calls } = makeDb();
    createPublicListingClient.mockReturnValue(db);
    const response = await postApply("abcDEF123456", { answers: ANSWERS }, {
      "x-forwarded-for": "198.51.100.99, 70.41.3.18",
    });
    expect(response.status).toBe(200);
    expect(calls.rpc).toHaveLength(1);
    expect(calls.rpc[0].args.p_ip_hash).toBe(expected);
  });

  it("falls back to the unknown bucket when the edge address is absent", async () => {
    const { createHash } = await import("node:crypto");
    const expected = createHash("sha256").update("r21-application:unknown").digest("hex");
    const { db, calls } = makeDb();
    createPublicListingClient.mockReturnValue(db);
    const request = new Request("https://t/abcDEF123456", {
      method: "POST",
      body: JSON.stringify({ answers: ANSWERS }),
      headers: { "x-forwarded-for": "198.51.100.99" },
    });
    const response = await POST(request, { params: Promise.resolve({ slug: "abcDEF123456" }) });
    expect(response.status).toBe(200);
    expect(calls.rpc).toHaveLength(1);
    expect(calls.rpc[0].args.p_ip_hash).toBe(expected);
  });
});
