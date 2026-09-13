import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createPublicReservationClient } = vi.hoisted(() => ({ createPublicReservationClient: vi.fn() }));
vi.mock("@/lib/supabase/createPublicReservationClient", () => ({ createPublicReservationClient }));
import { GET, POST } from "./route";

function listingQuery(data) {
  return { select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data, error: null }) })) })) })) };
}

describe("public booking route", () => {
  beforeEach(() => vi.clearAllMocks());
  it("returns a deliberately shaped active listing without owner or unit identifiers", async () => {
    createPublicReservationClient.mockReturnValue({ from: vi.fn(() => listingQuery({ owner_id: "private-owner", unit_id: "private-unit", inventory_type: "cabin", booking_status: "active", public_name: "Pine Cabin", public_description: "Quiet", maximum_guests: 4, minimum_nights: 2, maximum_nights: 14, check_in_time: "15:00", check_out_time: "11:00", amenities: ["firepit"], public_cancellation_policy: "Contact us.", public_guest_agreement: "Follow the cabin rules." })) });
    const response = await GET(new NextRequest("https://test/api/book/stay-safe"), { params: Promise.resolve({ slug: "stay-safe" }) });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.listing).toMatchObject({ publicName: "Pine Cabin", maximumGuests: 4, cancellationPolicy: "Contact us.", guestAgreement: "Follow the cabin rules." });
    expect(body.listing.owner_id).toBeUndefined(); expect(body.listing.unit_id).toBeUndefined();
  });
  it("cannot confirm without explicit review and typed BOOK", async () => {
    createPublicReservationClient.mockReturnValue({});
    const response = await POST(new NextRequest("https://test/api/book/stay-safe", { method: "POST", body: JSON.stringify({ operation: "confirm", guestName: "Guest", guestEmail: "guest@example.test", checkIn: "2026-10-01", checkOut: "2026-10-03", guestCount: 2 }) }), { params: Promise.resolve({ slug: "stay-safe" }) });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/type BOOK/);
  });
});
