import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createPublicReservationClient } = vi.hoisted(() => ({ createPublicReservationClient: vi.fn() }));
vi.mock("@/lib/supabase/createPublicReservationClient", () => ({ createPublicReservationClient }));
import { GET } from "./route";

describe("public reservation access route", () => {
  beforeEach(() => vi.clearAllMocks());
  it("requires a private credential", async () => {
    const response = await GET(new NextRequest("https://test/api/book/stay/access"), { params: Promise.resolve({ slug: "stay" }) });
    expect(response.status).toBe(400);
  });
  it("returns only the RPC-shaped release state", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: { publicName: "Pine Cabin", available: false, availableAt: "2026-10-01T15:00:00Z", arrivalInstructions: null }, error: null })
      .mockResolvedValueOnce({ data: { bookingBalanceCents: 20000, securityDepositCents: 5000, bookingAmountDueCents: 20000, bookingPaymentStatus: "unpaid", settlementStatus: "not_applicable", paymentCollectionEnabled: false }, error: null });
    createPublicReservationClient.mockReturnValue({ rpc });
    const response = await GET(new NextRequest("https://test/api/book/stay/access?token=private"), { params: Promise.resolve({ slug: "stay" }) });
    expect(response.status).toBe(200);
    const body = await response.json();\n    expect(body.access.arrivalInstructions).toBeNull();\n    expect(body.access.financial).toMatchObject({ bookingPaymentStatus: "unpaid", paymentCollectionEnabled: false });
    expect(rpc).toHaveBeenCalledWith("get_public_reservation_access", { p_booking_slug: "stay", p_access_token: "private" });\n    expect(rpc).toHaveBeenCalledWith("get_public_reservation_financial_summary", { p_booking_slug: "stay", p_access_token: "private" });
  });
});
