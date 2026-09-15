import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createAuthenticatedRentalManagerApplication } = vi.hoisted(() => ({
  createAuthenticatedRentalManagerApplication: vi.fn(),
}));
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication }));

const { decodeReservationPreview } = vi.hoisted(() => ({ decodeReservationPreview: vi.fn() }));
vi.mock("@/domains/reservations/previewToken", () => ({
  decodeReservationPreview,
  encodeReservationPreview: vi.fn(),
}));

const QUOTE = { lodgingAmountCents: 30000, cleaningFeeCents: 5000, lodgingTaxCents: 2000, securityDepositCents: 10000, totalDueCents: 47000, currencyCode: "USD" };
vi.mock("@/domains/reservations/quote", () => ({ quoteReservation: vi.fn(() => QUOTE) }));
vi.mock("@/domains/reservations/availability", () => ({
  buildAvailabilityCalendar: vi.fn(() => ({})),
  canReserveRange: vi.fn(() => ({ allowed: true })),
}));

import { PATCH } from "./route";

const INPUT = { unitId: "cabin-1", guestName: "", guestEmail: "", guestPhone: "", checkIn: "2099-02-01", checkOut: "2099-02-05", guestCount: 2, ownerNotes: "" };

function patchRequest(body) {
  return new NextRequest("https://forge.test/api/rental/reservations", { method: "PATCH", body: JSON.stringify(body) });
}

// A chainable + thenable stand-in for Supabase's PostgrestFilterBuilder: every chained method
// (.select/.eq/.in) returns the same self-referential object, and the object itself resolves
// (via .then, exactly like the real builder does under `await`/Promise.all) to { data, error }.
function queryStub(data) {
  const node = {
    select: vi.fn(() => node),
    eq: vi.fn(() => node),
    in: vi.fn(() => node),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
    then: (resolve) => resolve({ data, error: null }),
  };
  return node;
}

function mockComputeDependencies(from) {
  from.mockImplementation((table) => {
    if (table === "reservation_inventory_settings") return queryStub({ maximum_guests: 8, minimum_nights: 1, maximum_nights: 30, turnover_buffer_hours: 0, cleaning_fee_cents: 5000, security_deposit_cents: 10000, lodging_tax_basis_points: 0 });
    if (table === "reservation_rate_plans") return queryStub([]);
    if (table === "reservation_calendar_blocks") return queryStub([]);
    if (table === "reservations") return queryStub([]);
    return queryStub([]);
  });
}

describe("reservation lifecycle PATCH route error passthrough (modify_owner_reservation)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  function baseApp(rpc) {
    const from = vi.fn();
    mockComputeDependencies(from);
    return { effectiveOwnerId: "owner-a", user: { id: "user-a" }, supabaseClient: { from, rpc } };
  }

  it("surfaces modify_owner_reservation's price-immutability guard message verbatim instead of a generic failure", async () => {
    decodeReservationPreview.mockReturnValue({ operation: "modify", reservationId: "reservation-1", ownerId: "owner-a", actingUserId: "user-a", input: INPUT, quote: QUOTE });
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "Reservation pricing is immutable once a financial contract exists; modify_owner_reservation cannot change price. Pass the reservation's existing amounts unchanged." } });
    createAuthenticatedRentalManagerApplication.mockResolvedValue(baseApp(rpc));
    const response = await PATCH(patchRequest({ reservationId: "reservation-1", operation: "confirm_modification", acknowledged: true, confirmationText: "MODIFY", previewToken: "token", ...INPUT }));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toMatch(/Reservation pricing is immutable/);
  });

  it("still redacts a genuinely unexpected RPC error to the generic message (regex not over-widened)", async () => {
    decodeReservationPreview.mockReturnValue({ operation: "modify", reservationId: "reservation-1", ownerId: "owner-a", actingUserId: "user-a", input: INPUT, quote: QUOTE });
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "unexpected internal database failure xyz123" } });
    createAuthenticatedRentalManagerApplication.mockResolvedValue(baseApp(rpc));
    const response = await PATCH(patchRequest({ reservationId: "reservation-1", operation: "confirm_modification", acknowledged: true, confirmationText: "MODIFY", previewToken: "token", ...INPUT }));
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body.error).toBe("Unable to update reservation.");
  });
});
