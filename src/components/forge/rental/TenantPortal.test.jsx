// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import TenantPortal, { buildTenantPaymentSummary, isChargePayableThroughForge, isValidPublishableKey, paymentPendingForCharge, resumablePaymentForCharge } from "./TenantPortal.jsx";

const forgeSchedule = { id: "schedule_1", collectionMode: "forge", forgeCutoverDate: "2026-01-01" };
const externalSchedule = { id: "schedule_2", collectionMode: "external", forgeCutoverDate: null };

describe("tenant payment summary", () => {
  it("shows only unpaid, FORGE-payable rent in the current balance", () => {
    expect(buildTenantPaymentSummary([{ schedules: [forgeSchedule], charges: [
      { scheduleId: "schedule_1", dueDate: "2026-08-01", amountCents: 125000, paidAmountCents: 25000, status: "partially_paid" },
      { scheduleId: "schedule_1", dueDate: "2026-08-01", amountCents: 125000, paidAmountCents: 125000, status: "paid" },
      { scheduleId: "schedule_1", dueDate: "2026-08-01", amountCents: 5000, paidAmountCents: 0, status: "void" },
    ] }], true)).toEqual({ dueCents: 100000, openCharges: 1, externallyManagedCents: 0, externallyManagedChargeCount: 0 });
  });
  it("blocks a duplicate attempt while ACH is processing", () => {
    expect(paymentPendingForCharge([{ chargeId: "charge_1", status: "processing" }], "charge_1")).toBe(true);
    expect(paymentPendingForCharge([{ chargeId: "charge_1", status: "failed" }], "charge_1")).toBe(false);
  });

  // Rental billing cutover containment: an externally-managed charge must never inflate the
  // FORGE-payable "Current balance" — it is real, but surfaced only via the separate
  // externallyManaged fields, never hidden.
  it("excludes an externally-managed open charge from dueCents/openCharges and surfaces it separately", () => {
    expect(buildTenantPaymentSummary([{ schedules: [externalSchedule], charges: [
      { scheduleId: "schedule_2", dueDate: "2026-08-01", amountCents: 200000, paidAmountCents: 0, status: "due" },
    ] }], true)).toEqual({ dueCents: 0, openCharges: 0, externallyManagedCents: 200000, externallyManagedChargeCount: 1 });
  });

  it("treats a charge with no matching schedule as externally managed (fails safe)", () => {
    expect(buildTenantPaymentSummary([{ schedules: [], charges: [
      { scheduleId: "schedule_missing", dueDate: "2026-08-01", amountCents: 200000, paidAmountCents: 0, status: "due" },
    ] }], true)).toMatchObject({ dueCents: 0, externallyManagedCents: 200000 });
  });

  // Owner-level master pause: an otherwise fully FORGE-eligible charge must fall into the
  // externally-managed bucket while the owner's rental billing is globally paused.
  it("treats an otherwise FORGE-eligible charge as externally managed while the owner's rental billing is globally paused", () => {
    expect(buildTenantPaymentSummary([{ schedules: [forgeSchedule], charges: [
      { scheduleId: "schedule_1", dueDate: "2026-08-01", amountCents: 200000, paidAmountCents: 0, status: "due" },
    ] }], false)).toEqual({ dueCents: 0, openCharges: 0, externallyManagedCents: 200000, externallyManagedChargeCount: 1 });
  });
});

describe("isChargePayableThroughForge", () => {
  it("is payable for a forge schedule with an arrived cutover on or before the charge's due date, while billing is enabled", () => {
    expect(isChargePayableThroughForge({ scheduleId: "schedule_1", dueDate: "2026-08-01" }, [forgeSchedule], true, "2026-08-16")).toBe(true);
  });
  it("is not payable for an external schedule", () => {
    expect(isChargePayableThroughForge({ scheduleId: "schedule_2", dueDate: "2026-08-01" }, [externalSchedule], true, "2026-08-16")).toBe(false);
  });
  it("is not payable when no schedule matches the charge's scheduleId", () => {
    expect(isChargePayableThroughForge({ scheduleId: "schedule_missing", dueDate: "2026-08-01" }, [forgeSchedule], true, "2026-08-16")).toBe(false);
  });

  // Owner-level master pause: must block even an otherwise fully-eligible, individually
  // FORGE-activated schedule — per-schedule activation alone must never be sufficient.
  it("is not payable when the owner's rental billing is globally paused, even for an otherwise-eligible forge schedule", () => {
    expect(isChargePayableThroughForge({ scheduleId: "schedule_1", dueDate: "2026-08-01" }, [forgeSchedule], false, "2026-08-16")).toBe(false);
  });
  it("is not payable when billingEnabled is undefined (fails safe, e.g. before the portal payload has loaded)", () => {
    expect(isChargePayableThroughForge({ scheduleId: "schedule_1", dueDate: "2026-08-01" }, [forgeSchedule], undefined, "2026-08-16")).toBe(false);
  });
});

describe("resumablePaymentForCharge", () => {
  it("finds a resumable payment for created, requires_payment_method, or requires_action", () => {
    for (const status of ["created", "requires_payment_method", "requires_action"]) {
      expect(resumablePaymentForCharge([{ id: "pay_1", chargeId: "charge_1", status }], "charge_1")).toMatchObject({ id: "pay_1" });
    }
  });
  it("does not treat a processing payment as resumable", () => {
    expect(resumablePaymentForCharge([{ id: "pay_1", chargeId: "charge_1", status: "processing" }], "charge_1")).toBeNull();
  });
  it("does not treat a succeeded payment as resumable", () => {
    expect(resumablePaymentForCharge([{ id: "pay_1", chargeId: "charge_1", status: "succeeded" }], "charge_1")).toBeNull();
  });
});

describe("isValidPublishableKey", () => {
  it("accepts test and live publishable key prefixes", () => {
    expect(isValidPublishableKey("pk_test_abc123")).toBe(true);
    expect(isValidPublishableKey("pk_live_abc123")).toBe(true);
  });
  it("rejects a missing, blank, or secret-key value", () => {
    expect(isValidPublishableKey(undefined)).toBe(false);
    expect(isValidPublishableKey("")).toBe(false);
    expect(isValidPublishableKey("sk_test_abc123")).toBe(false);
  });
});

const openChargePortal = {
  tenant: { displayName: "Brandy Morgan" },
  billingEnabled: true,
  rentals: [{
    lease: { id: "lease_1", startDate: "2026-08-19", endDate: null },
    unit: { label: "TEST-" },
    schedules: [forgeSchedule],
    charges: [{ id: "charge_1", scheduleId: "schedule_1", dueDate: "2026-09-01", period: "2026-09", chargeType: "rent", status: "due", amountCents: 2000, paidAmountCents: 0 }],
    payments: [],
  }],
};

describe("TenantPortal charge action labeling", () => {
  it("shows Resume payment instead of a permanently disabled Payment pending for a requires_payment_method payment", () => {
    const portal = { ...openChargePortal, rentals: [{ ...openChargePortal.rentals[0],
      payments: [{ id: "rental_payment_1", chargeId: "charge_1", status: "requires_payment_method", createdAt: "2026-08-20T00:00:00Z" }] }] };
    const markup = renderToStaticMarkup(<TenantPortal initialPortal={portal} />);
    expect(markup).toContain("Resume payment");
    expect(markup).not.toContain("Payment pending");
  });

  it("keeps a processing payment as non-resumable Payment pending", () => {
    const portal = { ...openChargePortal, rentals: [{ ...openChargePortal.rentals[0],
      payments: [{ id: "rental_payment_1", chargeId: "charge_1", status: "processing", createdAt: "2026-08-20T00:00:00Z" }] }] };
    const markup = renderToStaticMarkup(<TenantPortal initialPortal={portal} />);
    expect(markup).toContain("Payment pending");
    expect(markup).not.toContain("Resume payment");
  });

  it("shows Pay now when there is no pending or resumable payment", () => {
    const markup = renderToStaticMarkup(<TenantPortal initialPortal={openChargePortal} />);
    expect(markup).toContain("Pay now");
  });
});

// Rendered-component regression guard: the tenant portal must never present an externally-managed
// charge as payable, even though it remains fully visible in the per-charge list.
describe("TenantPortal collection-authority containment", () => {
  const externallyManagedPortal = {
    tenant: { displayName: "Brandy Morgan" },
    billingEnabled: true,
    rentals: [{
      lease: { id: "lease_1", startDate: "2026-08-19", endDate: null },
      unit: { label: "TEST-" },
      schedules: [externalSchedule],
      charges: [{ id: "charge_1", scheduleId: "schedule_2", dueDate: "2026-08-01", period: "2026-08", chargeType: "rent", status: "due", amountCents: 1427000, paidAmountCents: 0 }],
      payments: [],
    }],
  };

  it("never renders Pay now for an externally-managed charge, and labels it Managed in Rentec instead", () => {
    const markup = renderToStaticMarkup(<TenantPortal initialPortal={externallyManagedPortal} />);
    expect(markup).not.toContain("Pay now");
    expect(markup).toContain("Managed in Rentec");
  });

  it("still renders the externally-managed charge itself and its amount — never hidden", () => {
    const markup = renderToStaticMarkup(<TenantPortal initialPortal={externallyManagedPortal} />);
    expect(markup).toContain("$14,270.00");
  });

  it("shows a FORGE-payable current balance of zero, with the externally-managed amount called out separately", () => {
    const markup = renderToStaticMarkup(<TenantPortal initialPortal={externallyManagedPortal} />);
    expect(markup).toContain("You have no FORGE-payable balance.");
    expect(markup).toContain("is still managed in Rentec and is not payable here");
  });

  it("shows Pay now again for a lease that has been individually cut over to FORGE", () => {
    const markup = renderToStaticMarkup(<TenantPortal initialPortal={openChargePortal} />);
    expect(markup).toContain("Pay now");
    expect(markup).not.toContain("Managed in Rentec");
  });
});

// Owner-level master pause: must block Pay now even for a lease individually cut over to FORGE —
// per-schedule activation alone must never be sufficient while the owner's billing is paused.
describe("TenantPortal rental billing master pause", () => {
  const pausedButOtherwiseEligiblePortal = { ...openChargePortal, billingEnabled: false };

  it("never renders Pay now while the owner's rental billing is globally paused, even for an individually cut-over lease", () => {
    const markup = renderToStaticMarkup(<TenantPortal initialPortal={pausedButOtherwiseEligiblePortal} />);
    expect(markup).not.toContain("Pay now");
    expect(markup).toContain("Managed in Rentec");
  });

  it("shows a FORGE-payable current balance of zero while globally paused, even though the schedule is individually forge-activated", () => {
    const markup = renderToStaticMarkup(<TenantPortal initialPortal={pausedButOtherwiseEligiblePortal} />);
    expect(markup).toContain("You have no FORGE-payable balance.");
  });

  it("still renders the charge itself and its amount while paused — never hidden", () => {
    const markup = renderToStaticMarkup(<TenantPortal initialPortal={pausedButOtherwiseEligiblePortal} />);
    expect(markup).toContain("$20.00");
  });
});

function findButtonByText(container, text) {
  const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent === text);
  if (!button) throw new Error(`No button found with text "${text}"`);
  return button;
}
async function clickButtonAndFlush(button) {
  await act(async () => {
    button.click();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });
}
function mountPanel(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(ui); });
  return { container, root };
}
function unmountPanel({ container, root }) {
  act(() => { root.unmount(); });
  container.remove();
}

describe("TenantPortal Stripe initialization failure", () => {
  let mounted;
  afterEach(() => {
    if (mounted) { unmountPanel(mounted); mounted = null; }
    vi.unstubAllGlobals();
  });

  it("surfaces a clear error instead of an infinite disabled state when Stripe.js fails to initialize, and retry does not create another payment attempt", async () => {
    const sessionBody = { success: true, clientSecret: "pi_test_secret", connectedAccountId: "acct_1",
      paymentId: "rental_payment_1", amountCents: 2000, currencyCode: "USD", dueDate: "2026-09-01",
      period: "2026-09", chargeType: "rent", returnUrl: "https://forge.test/return" };
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: async () => sessionBody }));
    vi.stubGlobal("fetch", fetchMock);

    mounted = mountPanel(<TenantPortal initialPortal={openChargePortal} />);
    const { container } = mounted;

    await clickButtonAndFlush(findButtonByText(container, "Pay now"));

    expect(container.textContent).toContain("Unable to load the secure payment form");
    const paymentSessionCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/payment-session"));
    expect(paymentSessionCalls).toHaveLength(1);

    await clickButtonAndFlush(findButtonByText(container, "Retry loading payment form"));

    expect(container.textContent).toContain("Unable to load the secure payment form");
    const paymentSessionCallsAfterRetry = fetchMock.mock.calls.filter(([url]) => String(url).includes("/payment-session"));
    expect(paymentSessionCallsAfterRetry).toHaveLength(1);
  });

  it("lets the tenant return to the balance view from the Stripe error state without losing the pending payment", async () => {
    const sessionBody = { success: true, clientSecret: "pi_test_secret", connectedAccountId: "acct_1",
      paymentId: "rental_payment_1", amountCents: 2000, currencyCode: "USD", dueDate: "2026-09-01",
      period: "2026-09", chargeType: "rent", returnUrl: "https://forge.test/return" };
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: async () => sessionBody }));
    vi.stubGlobal("fetch", fetchMock);

    mounted = mountPanel(<TenantPortal initialPortal={openChargePortal} />);
    const { container } = mounted;

    await clickButtonAndFlush(findButtonByText(container, "Pay now"));
    expect(container.textContent).toContain("Unable to load the secure payment form");

    await clickButtonAndFlush(findButtonByText(container, "Back to balance"));
    expect(container.textContent).toContain("Current balance");
  });
});
