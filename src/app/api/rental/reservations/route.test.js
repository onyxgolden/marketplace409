import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), from: vi.fn(), eq: vi.fn() }));
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: mocks.authenticate }));
import { GET } from "./route";
describe("owner reservation finance read model authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue({ effectiveOwnerId: "canonical-owner", user: { id: "acting-member" }, supabaseClient: { from: mocks.from } });
    mocks.from.mockImplementation(table => {
      const result = { error: null, data: table === "reservations" ? [{ id: "res_test", owner_id: "canonical-owner" }]
        : table === "reservation_finance_summary" ? [{ reservation_id: "res_test", booking_payment_status: "paid", finance_payment_status: "paid", refund_status: "refunded", finance_settlement_status: "pending", payout_status: "not_paid_out", owner_id: "canonical-owner" }] : [] };
      const query = { select: () => query, eq: (...args) => { mocks.eq(table, ...args); return query; }, order: async () => result,
        then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) };
      return query;
    });
  });
  it("uses canonical workspace ownership for every read while preserving acting-user authorization", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    for (const table of ["reservations", "reservation_events", "reservation_finance_summary"]) {
      expect(mocks.eq).toHaveBeenCalledWith(table, "owner_id", "canonical-owner");
    }
    const body = await response.json();
    expect(body.reservations[0].financial).toMatchObject({ bookingPaymentStatus: "paid", refundStatus: "refunded", settlementStatus: "pending", payoutStatus: "not_paid_out" });
    expect(body.reservations[0].financial.owner_id).toBeUndefined();
  });
  it("honors an authentication denial before accessing finance data", async () => {
    mocks.authenticate.mockResolvedValue({ response: new Response(null, { status: 401 }) });
    expect((await GET()).status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
