import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createPublicListingClient", () => ({ createPublicListingClient: vi.fn() }));
import { createPublicListingClient } from "@/lib/supabase/createPublicListingClient";
import { GET } from "./route";
import { POST as apply } from "./apply/route";

function makeDb(tables = {}, rpcResult = { data: true, error: null }) {
  const calls = { insert: [], update: [], rpc: [] };
  const db = {
    rpc: vi.fn(async (name, args) => {
      calls.rpc.push({ name, args });
      return rpcResult;
    }),
    from: vi.fn((name) => {
      const cfg = tables[name] || {};
      const table = {
        select() { return table; },
        eq() { return table; },
        gte() { return table; },
        order() { return table; },
        limit() { return table; },
        insert(payload) { calls.insert.push({ table: name, payload }); return table; },
        update(payload) { calls.update.push({ table: name, payload }); return table; },
        async maybeSingle() { return { data: cfg.oneRow ?? null, error: null }; },
        async single() {
          if (calls.insert.some((call) => call.table === name)) return { data: cfg.insertedRow, error: null };
          return { data: cfg.updatedRow, error: null };
        },
        then(resolve) { resolve({ data: cfg.listRows || [], error: null }); },
      };
      return table;
    }),
    storage: { from: () => ({ download: async () => ({ data: null, error: new Error("no") }) }) },
  };
  return { db, calls };
}

const LISTING_ROW = {
  id: "listing_1", owner_id: "owner_1", title: "Sunny 2-bed", description: "Nice",
  rent_cents: 160000, beds_display: "2", baths_display: "1", square_feet: 900,
  pet_policy: "Cats OK", available_at: "2026-11-01T00:00:00Z", photos: [],
  contact_email: "leasing@example.com", contact_phone: null,
  listing_form_id: "form_1", public_slug: "abcDEF123456", view_count: 3,
};
const FORM_ROW = {
  id: "form_1", name: "Standard", sections: { personal_info: true, residence_history: true, employment: true, references: true },
  custom_questions: [], fee_amount_cents: 2500, consent_text: "Consent text",
};

const SLUG = "abcDEF123456";
const getListing = () => GET(new Request("https://t/"), { params: Promise.resolve({ slug: SLUG }) });
const postApply = (body) => apply(
  new Request("https://t/", { method: "POST", headers: { "x-forwarded-for": "9.9.9.9" }, body: JSON.stringify(body) }),
  { params: Promise.resolve({ slug: SLUG }) },
);
const validAnswers = () => ({
  personal: { firstName: "Sam", lastName: "Applicant", email: "sam@example.com", phone: "555-0100" },
  residence: { current: { address: "1 Main St", city: "Beaumont", state: "TX", landlordName: "Prior LLC" } },
  employment: { current: { employerName: "Refinery Co", jobTitle: "Operator" } },
  references: [{ name: "Rita", phone: "555-0101" }],
  custom: {}, consent: true,
});

describe("public listing route", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("404s a malformed slug", async () => {
    const { db } = makeDb();
    createPublicListingClient.mockReturnValue(db);
    const response = await GET(new Request("https://t/"), { params: Promise.resolve({ slug: "unit_1" }) });
    expect(response.status).toBe(404);
  });

  it("404s an unpublished or unknown listing", async () => {
    const { db } = makeDb();
    createPublicListingClient.mockReturnValue(db);
    expect((await getListing()).status).toBe(404);
  });

  it("returns the published listing with its form and no internal ids", async () => {
    const { db } = makeDb({
      rental_listings: { oneRow: LISTING_ROW },
      rental_listing_forms: { oneRow: FORM_ROW },
    });
    createPublicListingClient.mockReturnValue(db);
    const response = await getListing();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.listing.title).toBe("Sunny 2-bed");
    expect(body.listing.rentCents).toBe(160000);
    expect(body.listing.id).toBeUndefined();
    expect(body.listing.unitId).toBeUndefined();
    expect(body.form.feeAmountCents).toBe(2500);
    expect(body.form.consentText).toBe("Consent text");
  });
});

describe("public apply route", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  function intakeDb(extra = {}, rpcResult) {
    return makeDb({
      rental_listings: { oneRow: { id: "listing_1", owner_id: "owner_1", title: "Sunny 2-bed", listing_form_id: "form_1" } },
      rental_listing_forms: { oneRow: { sections: FORM_ROW.sections, custom_questions: [], fee_amount_cents: 2500 } },
      rental_applications: { insertedRow: { id: "app_9", submitted_at: "2026-10-01T10:00:00Z" } },
      ...extra,
    }, rpcResult);
  }

  it("silently swallows honeypot spam with a 200 and stores nothing", async () => {
    const { db, calls } = intakeDb();
    createPublicListingClient.mockReturnValue(db);
    const response = await postApply({ answers: validAnswers(), company: "spam bot co" });
    expect(response.status).toBe(200);
    expect(calls.insert).toHaveLength(0);
    expect(calls.rpc).toHaveLength(0);
  });

  it("400s invalid payloads against the form config", async () => {
    const { db } = intakeDb();
    createPublicListingClient.mockReturnValue(db);
    const answers = validAnswers();
    answers.personal.email = "bad";
    answers.consent = false;
    const response = await postApply({ answers, company: "" });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/email/i);
  });

  it("429s when the attempt RPC denies the submission", async () => {
    const { db, calls } = intakeDb({}, { data: false, error: null });
    createPublicListingClient.mockReturnValue(db);
    const response = await postApply({ answers: validAnswers(), company: "" });
    expect(response.status).toBe(429);
    expect(calls.rpc).toHaveLength(1);
    expect(calls.rpc[0].name).toBe("record_application_submission_attempt");
    expect(calls.insert).toHaveLength(0);
  });

  it("accepts a valid application as pending with the recorded fee", async () => {
    const { db, calls } = intakeDb();
    createPublicListingClient.mockReturnValue(db);
    const response = await postApply({ answers: validAnswers(), company: "" });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.applicationId).toBe("app_9");
    const stored = calls.insert.find((call) => call.table === "rental_applications").payload;
    expect(stored.status).toBe("pending");
    expect(stored.fee_amount_cents).toBe(2500);
    expect(stored.fee_recorded).toBe(true);
    expect(stored.owner_id).toBe("owner_1");
    // The attempt was recorded through the atomic RPC, not a route-side insert.
    expect(calls.rpc).toHaveLength(1);
    expect(calls.rpc[0].name).toBe("record_application_submission_attempt");
    expect(calls.insert.some((call) => call.table === "rental_application_rate_limits")).toBe(false);
  });

  it("404s applications to an unpublished listing", async () => {
    const { db, calls } = makeDb();
    createPublicListingClient.mockReturnValue(db);
    const response = await postApply({ answers: validAnswers(), company: "" });
    expect(response.status).toBe(404);
    expect(calls.rpc).toHaveLength(0);
  });
});
