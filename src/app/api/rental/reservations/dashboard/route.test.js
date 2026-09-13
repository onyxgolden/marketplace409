import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createAuthenticatedRentalManagerApplication } = vi.hoisted(() => ({
  createAuthenticatedRentalManagerApplication: vi.fn(),
}));
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication }));
import { GET } from "./route";

function query(data) { return { select: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data, error: null }) })) }; }
describe("reservation operations dashboard route", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("uses the canonical workspace and exposes no invented collected revenue", async () => {
    const from = vi.fn(table => table === "reservation_inventory_settings" ? query([{ unit_id: "cabin", inventory_type: "cabin", booking_status: "active" }]) : table === "reservations" ? query([{ unit_id: "cabin", status: "confirmed", check_in_date: "2099-01-01", check_out_date: "2099-01-03", total_due_cents: 30000 }]) : query([]));
    createAuthenticatedRentalManagerApplication.mockResolvedValue({ effectiveOwnerId: "owner-a", supabaseClient: { from } });
    const response = await GET(new NextRequest("https://forge.test/api/rental/reservations/dashboard?days=30"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(from).toHaveBeenCalledWith("reservations");
    expect(body.dashboard.summary.collectedRevenueCents).toBeNull();
    expect(body.dashboard.paymentLinkageAvailable).toBe(false);
  });
  it("rejects unsupported partial periods before querying data", async () => {
    createAuthenticatedRentalManagerApplication.mockResolvedValue({ effectiveOwnerId: "owner-a", supabaseClient: { from: vi.fn() } });
    const response = await GET(new NextRequest("https://forge.test/api/rental/reservations/dashboard?days=31"));
    expect(response.status).toBe(400);
  });
});
