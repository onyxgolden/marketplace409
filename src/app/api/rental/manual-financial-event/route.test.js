import { beforeEach, describe, expect, it, vi } from "vitest";
const from = vi.fn();
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({
  createAuthenticatedForgeApplication: vi.fn(async () => ({ user: { id: "owner_1" }, supabaseClient: { from } })),
}));
// SupabaseFinancialEventRepository imports the singleton `supabase` client eagerly
// at module load time; the route always passes its own client explicitly, so this
// mock only exists to stop that eager import from constructing a real client.
vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn() } }));
import { POST } from "./route.js";

const validBody = {
  eventDate: "2026-08-16",
  description: "Cash payment to Gulf Coast Plumbing",
  amount: "150.00",
  transactionKind: "expense",
  normalizedCategory: "property_repairs",
  paymentMethod: "cash",
};

function request(body) {
  return new Request("https://example.test/api/rental/manual-financial-event", { method: "POST", body: JSON.stringify(body) });
}

describe("manual financial event route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    from.mockImplementation(() => ({
      upsert: (rows) => ({
        select: async () => ({ data: rows.map((row, index) => ({ id: `financial_event_${index}`, ...row })), error: null }),
      }),
    }));
  });

  it("saves a valid manual entry through the financial event repository", async () => {
    const response = await POST(request(validBody));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.event).toMatchObject({ owner_id: "owner_1", amount: 150, transaction_kind: "expense", source_system: "manual" });
    expect(from).toHaveBeenCalledWith("financial_events");
  });

  it("stores the payment method in metadata", async () => {
    const response = await POST(request(validBody));
    const body = await response.json();
    expect(body.event.metadata).toEqual({ payment_method: "cash" });
  });

  it("rejects an invalid entry without touching the database", async () => {
    const response = await POST(request({ ...validBody, amount: -5 }));
    expect(response.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it("defaults tax_deductible to true for expenses and affects_noi to true", async () => {
    const response = await POST(request(validBody));
    const body = await response.json();
    expect(body.event).toMatchObject({ tax_deductible: true, affects_noi: true, capitalized: false });
  });
});
