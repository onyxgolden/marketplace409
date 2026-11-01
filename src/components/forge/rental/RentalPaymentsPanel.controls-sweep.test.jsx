import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { clearSWRCache } from "../../../hooks/swrCache";
import RentalPaymentsPanel from "./RentalPaymentsPanel";

// Panels seed parent-supplied initialData into the shared cache (first writer
// wins), so sequential renders with different fixtures must not leak entries.
beforeEach(() => { clearSWRCache(); });

const baseData = {
  openCharges: [], settlements: [],
  leases: [{ id: "lease_1", unit_id: "unit_1", property_id: "property-1", status: "active" }],
  units: [{ id: "unit_1", label: "Main residence", property_id: "property-1" }],
  tenants: [{ id: "tenant_1", display_name: "Anthony Babino" }],
  leaseMemberships: [{ lease_id: "lease_1", tenant_id: "tenant_1" }],
  schedules: [],
};

function withPayment(payment) {
  return { ...baseData, payments: [payment] };
}

function render(payment) {
  return renderToStaticMarkup(<RentalPaymentsPanel initialData={withPayment(payment)} initialAccount={null} />);
}

describe("RentalPaymentsPanel controls sweep — B2 void and refund", () => {
  const offlineReceived = {
    id: "pay_1", lease_id: "lease_1", amount_cents: 130000, refunded_amount_cents: 0,
    status: "succeeded", payment_method: "cash", provider: "offline",
    received_at: "2026-08-02T12:00:00Z", created_at: "2026-08-02T12:00:00Z",
    deposit_state: "received",
  };

  it("offers Void this payment for a settled offline payment awaiting deposit", () => {
    const markup = render(offlineReceived);
    expect(markup).toContain("Void this payment");
    expect(markup).not.toContain("Refund this payment");
  });

  it("explains the deposit gate instead of offering void for a deposited offline payment", () => {
    const markup = render({ ...offlineReceived, deposit_state: "deposited" });
    expect(markup).toContain("Voiding is unavailable while this payment is marked deposited");
    expect(markup).not.toContain("Void this payment");
  });

  it("offers Refund this payment for a settled Stripe payment", () => {
    const markup = render({
      id: "pay_2", lease_id: "lease_1", amount_cents: 130000, refunded_amount_cents: 0,
      status: "succeeded", payment_method: "card", provider: "stripe",
      created_at: "2026-08-02T12:00:00Z",
    });
    expect(markup).toContain("Refund this payment");
    expect(markup).not.toContain("Void this payment");
  });

  it("offers a refund of the remainder for a partially refunded Stripe payment", () => {
    const markup = render({
      id: "pay_3", lease_id: "lease_1", amount_cents: 130000, refunded_amount_cents: 50000,
      status: "partially_refunded", payment_method: "card", provider: "stripe",
      created_at: "2026-08-02T12:00:00Z",
    });
    expect(markup).toContain("Refund this payment");
  });

  it("explains the settlement gate for an in-flight Stripe payment", () => {
    const markup = render({
      id: "pay_4", lease_id: "lease_1", amount_cents: 130000, refunded_amount_cents: 0,
      status: "processing", payment_method: "card", provider: "stripe",
      created_at: "2026-08-02T12:00:00Z",
    });
    expect(markup).toContain("A refund opens once this payment settles.");
    expect(markup).not.toContain("Refund this payment");
  });

  it("offers neither action for an already refunded payment", () => {
    const markup = render({
      id: "pay_5", lease_id: "lease_1", amount_cents: 130000, refunded_amount_cents: 130000,
      status: "refunded", payment_method: "card", provider: "stripe",
      created_at: "2026-08-02T12:00:00Z",
    });
    expect(markup).not.toContain("Refund this payment");
    expect(markup).not.toContain("Void this payment");
  });
});
