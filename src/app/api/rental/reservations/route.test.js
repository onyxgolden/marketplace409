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

vi.mock("@/domains/reservations/quote", () => ({ quoteReservation: vi.fn() }));
vi.mock("@/domains/reservations/availability", () => ({
  buildAvailabilityCalendar: vi.fn(() => ({})),
  canReserveRange: vi.fn(() => ({ allowed: true })),
}));

import { GET, PATCH } from "./route";

// The reservation's own stored row, as modify_owner_reservation's caller must always read it back
// from -- the modify path never recomputes a quote or trusts client-supplied dates/unit once a
// reservation is confirmed (20260916000000's price-immutability guard, plus this route's own
// defense-in-depth rejection of a client attempt to change locked fields).
const CURRENT_RESERVATION = {
  id: "reservation-1", unit_id: "cabin-1", check_in_date: "2099-02-01", check_out_date: "2099-02-05",
  guest_count: 2, lodging_amount_cents: 30000, cleaning_fee_cents: 5000, lodging_tax_cents: 2000,
  security_deposit_cents: 10000, total_due_cents: 47000, currency_code: "USD", status: "confirmed",
  reservation_inventory_settings: { public_name: "Cabin One", inventory_type: "cabin", maximum_guests: 8 },
};
const LOCKED_INPUT = { unitId: "cabin-1", guestName: "", guestEmail: "", guestPhone: "", checkIn: "2099-02-01", checkOut: "2099-02-05", guestCount: 3, ownerNotes: "Late arrival" };
const STORED_QUOTE = { nights: 4, lodgingAmountCents: 30000, cleaningFeeCents: 5000, lodgingTaxCents: 2000, securityDepositCents: 10000, totalDueCents: 47000, currencyCode: "USD" };

function patchRequest(body) {
  return new NextRequest("https://forge.test/api/rental/reservations", { method: "PATCH", body: JSON.stringify(body) });
}

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

function baseApp(rpc, { current = CURRENT_RESERVATION } = {}) {
  const from = vi.fn((table) => (table === "reservations" ? queryStub(current) : queryStub(null)));
  return { effectiveOwnerId: "owner-a", user: { id: "user-a" }, supabaseClient: { from, rpc } };
}

function modifyRequestBody(overrides = {}) {
  return { reservationId: "reservation-1", operation: "confirm_modification", acknowledged: true, confirmationText: "MODIFY", previewToken: "token", unitId: "cabin-1", checkIn: "2099-02-01", checkOut: "2099-02-05", guestCount: 3, ownerNotes: "Late arrival", guestName: "", guestEmail: "", guestPhone: "", ...overrides };
}

describe("reservation lifecycle PATCH route: confirmed-reservation modify never recomputes price", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("surfaces modify_owner_reservation's price-immutability guard message verbatim instead of a generic failure", async () => {
    decodeReservationPreview.mockReturnValue({ operation: "modify", reservationId: "reservation-1", ownerId: "owner-a", actingUserId: "user-a", input: LOCKED_INPUT, quote: STORED_QUOTE });
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "Reservation pricing is immutable once a financial contract exists; modify_owner_reservation cannot change price. Pass the reservation's existing amounts unchanged." } });
    createAuthenticatedRentalManagerApplication.mockResolvedValue(baseApp(rpc));
    const response = await PATCH(patchRequest(modifyRequestBody()));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toMatch(/Reservation pricing is immutable/);
  });

  it("still redacts a genuinely unexpected RPC error to the generic message (regex not over-widened)", async () => {
    decodeReservationPreview.mockReturnValue({ operation: "modify", reservationId: "reservation-1", ownerId: "owner-a", actingUserId: "user-a", input: LOCKED_INPUT, quote: STORED_QUOTE });
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "unexpected internal database failure xyz123" } });
    createAuthenticatedRentalManagerApplication.mockResolvedValue(baseApp(rpc));
    const response = await PATCH(patchRequest(modifyRequestBody()));
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body.error).toBe("Unable to update reservation.");
  });

  it("a guest-count/notes-only modify request succeeds, sending the reservation's own stored price/dates/unit back unchanged", async () => {
    decodeReservationPreview.mockReturnValue({ operation: "modify", reservationId: "reservation-1", ownerId: "owner-a", actingUserId: "user-a", input: LOCKED_INPUT, quote: STORED_QUOTE });
    const rpc = vi.fn().mockResolvedValue({ data: { ...CURRENT_RESERVATION, guest_count: 3, owner_notes: "Late arrival" }, error: null });
    createAuthenticatedRentalManagerApplication.mockResolvedValue(baseApp(rpc));
    const response = await PATCH(patchRequest(modifyRequestBody()));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(rpc).toHaveBeenCalledWith("modify_owner_reservation", expect.objectContaining({
      p_owner_id: "owner-a", p_reservation_id: "reservation-1",
      p_unit_id: "cabin-1", p_check_in_date: "2099-02-01", p_check_out_date: "2099-02-05",
      p_guest_count: 3, p_owner_notes: "Late arrival",
      p_lodging_amount_cents: 30000, p_cleaning_fee_cents: 5000, p_lodging_tax_cents: 2000,
      p_security_deposit_cents: 10000, p_total_due_cents: 47000, p_currency_code: "USD",
    }));
  });

  it("rejects a client attempt to change check-in date on a confirmed reservation without ever calling the RPC (defense in depth)", async () => {
    decodeReservationPreview.mockReturnValue({ operation: "modify", reservationId: "reservation-1", ownerId: "owner-a", actingUserId: "user-a", input: LOCKED_INPUT, quote: STORED_QUOTE });
    const rpc = vi.fn();
    createAuthenticatedRentalManagerApplication.mockResolvedValue(baseApp(rpc));
    const response = await PATCH(patchRequest(modifyRequestBody({ checkIn: "2099-03-01" })));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toMatch(/Dates and unit cannot be changed/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a client attempt to change the unit on a confirmed reservation without ever calling the RPC (defense in depth)", async () => {
    decodeReservationPreview.mockReturnValue({ operation: "modify", reservationId: "reservation-1", ownerId: "owner-a", actingUserId: "user-a", input: LOCKED_INPUT, quote: STORED_QUOTE });
    const rpc = vi.fn();
    createAuthenticatedRentalManagerApplication.mockResolvedValue(baseApp(rpc));
    const response = await PATCH(patchRequest(modifyRequestBody({ unitId: "cabin-2" })));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toMatch(/Dates and unit cannot be changed/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("preview_modification also rejects a locked-field change up front and never builds a preview", async () => {
    const rpc = vi.fn();
    createAuthenticatedRentalManagerApplication.mockResolvedValue(baseApp(rpc));
    const response = await PATCH(patchRequest({ reservationId: "reservation-1", operation: "preview_modification", unitId: "cabin-1", checkIn: "2099-02-02", checkOut: "2099-02-05", guestCount: 3, ownerNotes: "Late arrival", guestName: "", guestEmail: "", guestPhone: "" }));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toMatch(/Dates and unit cannot be changed/);
  });

  it("preview_modification returns the reservation's stored price as the quote, without recomputing it", async () => {
    createAuthenticatedRentalManagerApplication.mockResolvedValue(baseApp(vi.fn()));
    const response = await PATCH(patchRequest({ reservationId: "reservation-1", operation: "preview_modification", unitId: "cabin-1", checkIn: "2099-02-01", checkOut: "2099-02-05", guestCount: 3, ownerNotes: "Late arrival", guestName: "", guestEmail: "", guestPhone: "" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.preview.quote).toEqual(STORED_QUOTE);
    expect(body.preview.input).toEqual(LOCKED_INPUT);
  });
});

describe("owner reservation finance read model authorization", () => {
  let from;
  let eqCalls;

  beforeEach(() => {
    vi.clearAllMocks();
    from = vi.fn();
    eqCalls = vi.fn();
    createAuthenticatedRentalManagerApplication.mockResolvedValue({ effectiveOwnerId: "canonical-owner", user: { id: "acting-member" }, supabaseClient: { from } });
    from.mockImplementation((table) => {
      const result = { error: null, data: table === "reservations" ? [{ id: "res_test", owner_id: "canonical-owner" }]
        : table === "reservation_finance_summary" ? [{ reservation_id: "res_test", booking_payment_status: "paid", finance_payment_status: "paid", refund_status: "refunded", finance_settlement_status: "pending", payout_status: "not_paid_out", owner_id: "canonical-owner" }] : [] };
      const query = { select: () => query, eq: (...args) => { eqCalls(table, ...args); return query; }, order: async () => result,
        then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) };
      return query;
    });
  });

  it("uses canonical workspace ownership for every read while preserving acting-user authorization", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    for (const table of ["reservations", "reservation_events", "reservation_finance_summary"]) {
      expect(eqCalls).toHaveBeenCalledWith(table, "owner_id", "canonical-owner");
    }
    const body = await response.json();
    expect(body.reservations[0].financial).toMatchObject({ bookingPaymentStatus: "paid", refundStatus: "refunded", settlementStatus: "pending", payoutStatus: "not_paid_out" });
    expect(body.reservations[0].financial.owner_id).toBeUndefined();
  });

  it("honors an authentication denial before accessing finance data", async () => {
    createAuthenticatedRentalManagerApplication.mockResolvedValue({ response: new Response(null, { status: 401 }) });
    expect((await GET()).status).toBe(401);
    expect(from).not.toHaveBeenCalled();
  });
});
