import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authenticated = { user: { id: "owner_1" }, supabaseClient: {} };
const unauthenticatedResponse = { response: new Response(JSON.stringify({ error: "Authenticated owner id is required." }), { status: 401 }) };
const createAuthenticatedForgeApplication = vi.fn(async () => authenticated);
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({ createAuthenticatedForgeApplication: (...args) => createAuthenticatedForgeApplication(...args) }));

import { POST } from "./route.js";

function request(body) {
  return new NextRequest("https://forge.test/api/rental/reconciliation-preview", { method: "POST", body: JSON.stringify(body) });
}

function chargesRow(overrides = {}) {
  return { id: "charge_1", lease_id: "lease_1", period: "2026-08", amount_cents: 150000, paid_amount_cents: 0, status: "due", due_date: "2026-08-01", ...overrides };
}
function scheduleRow(overrides = {}) {
  return { id: "schedule_1", lease_id: "lease_1", collection_mode: "forge", forge_cutover_date: "2026-08-01", effective_start_date: "2026-08-01", ...overrides };
}

function mockDatabase({ charges = [chargesRow()], schedules = [scheduleRow()] } = {}) {
  return {
    from: (table) => {
      if (table === "rent_charges") return { select: () => ({ eq: () => Promise.resolve({ data: charges, error: null }) }) };
      if (table === "rent_schedules") return { select: () => ({ eq: () => Promise.resolve({ data: schedules, error: null }) }) };
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

describe("rental reconciliation preview route", () => {
  it("rejects unauthenticated callers", async () => {
    createAuthenticatedForgeApplication.mockResolvedValueOnce(unauthenticatedResponse);
    const response = await POST(request({ rentecTransactions: [] }));
    expect(response.status).toBe(401);
  });

  it("requires an id, leaseId, and integer amountCents on every submitted Rentec transaction", async () => {
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: mockDatabase() });
    const response = await POST(request({ rentecTransactions: [{ leaseId: "lease_1", amountCents: 100 }] }));
    expect(response.status).toBe(400);
  });

  it("never writes anything — only reads rent_charges and rent_schedules for the authenticated owner", async () => {
    const db = mockDatabase();
    const fromSpy = vi.spyOn(db, "from");
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: db });
    const response = await POST(request({ rentecTransactions: [] }));
    expect(response.status).toBe(200);
    const tables = fromSpy.mock.calls.map(([table]) => table);
    expect(tables.sort()).toEqual(["rent_charges", "rent_schedules"]);
  });

  it("returns a confidently-matched classification for a matching Rentec transaction and FORGE charge", async () => {
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: mockDatabase() });
    const response = await POST(request({ rentecTransactions: [{ id: "t1", leaseId: "lease_1", amountCents: 150000, period: "2026-08" }] }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.preview.classificationCounts.confidently_matched_rentec_payment).toBe(1);
  });

  it("labels the response as preview_only with a notice that nothing can be approved yet", async () => {
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: mockDatabase() });
    const response = await POST(request({ rentecTransactions: [] }));
    const body = await response.json();
    expect(body.status).toBe("preview_only");
    expect(body.notice).toMatch(/no data was written/i);
  });

  it("classifies a pre-cutover FORGE charge for an external-mode lease — the exact externally-managed reconciliation-required containment case", async () => {
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: mockDatabase({
      schedules: [scheduleRow({ collection_mode: "external", forge_cutover_date: null })],
    }) });
    const response = await POST(request({ rentecTransactions: [] }));
    const body = await response.json();
    expect(body.preview.classificationCounts.future_or_pre_cutover_forge_charge).toBe(1);
  });
});
