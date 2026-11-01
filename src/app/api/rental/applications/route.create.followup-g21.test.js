import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({ getActiveWorkspaceRole: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { POST } from "./route";

// Controls-sweep follow-up G21 (O-11): landlord paper application entry.
function makeDb({ listing = { id: "listing_1" }, inserted = [] } = {}) {
  const chainFor = (table) => {
    const chain = {
      select() { return chain; }, eq() { return chain; },
      insert(row) { inserted.push({ table, row }); return chain; },
      async maybeSingle() {
        if (table === "rental_listings") return { data: listing, error: null };
        return { data: null, error: null };
      },
      async single() {
        const row = inserted.find((item) => item.table === "rental_applications")?.row || {};
        return { data: { id: "app_new", listing_id: row.listing_id, form_id: row.form_id, status: row.status,
          answers: row.answers, fee_amount_cents: row.fee_amount_cents, fee_recorded: row.fee_recorded,
          denial_reason: null, tenant_id: null, lease_id: null, decided_by: null, decided_at: null,
          submitted_at: row.submitted_at }, error: null };
      },
    };
    return chain;
  };
  return { inserted, from: (table) => chainFor(table) };
}

function authAs(db, role = "owner") {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user_1" }, effectiveOwnerId: "owner_1", supabaseClient: db,
  });
  getActiveWorkspaceRole.mockResolvedValue(role);
}

const req = (body) => new Request("https://t/", { method: "POST", body: JSON.stringify(body) });

describe("application create follow-up G21", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("O-11: paper entry lands pending with the applicant's answers", async () => {
    const db = makeDb({});
    authAs(db);
    const res = await POST(req({ listingId: "listing_1",
      answers: { personal: { firstName: "Pat", lastName: "Paper", email: "pat@example.com", phone: "555-1" } } }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.application.status).toBe("pending");
    expect(body.application.answers.personal.firstName).toBe("Pat");
    const row = db.inserted.find((item) => item.table === "rental_applications").row;
    expect(row.fee_amount_cents).toBe(0);
    expect(row.form_id).toBeNull();
  });

  it("O-11: unknown listing 404s, unnamed applicant 400s, read-only 403s", async () => {
    authAs(makeDb({ listing: null }));
    expect((await POST(req({ listingId: "nope", answers: { personal: { firstName: "Pat" } } }))).status).toBe(404);
    authAs(makeDb({}));
    expect((await POST(req({ listingId: "listing_1", answers: { personal: {} } }))).status).toBe(400);
    expect((await POST(req({ listingId: "", answers: { personal: { firstName: "Pat" } } }))).status).toBe(400);
    authAs(makeDb({}), "read_only");
    expect((await POST(req({ listingId: "listing_1", answers: { personal: { firstName: "Pat" } } }))).status).toBe(403);
  });
});
