// @vitest-environment jsdom
// R13: payment schedule block -- plain-English cadence display and the
// tenant's self-scheduling form.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import PaymentFrequencyPicker, { paymentFrequencyDescription } from "./PaymentFrequencyPicker.jsx";
import TenantPaymentSchedulePanel from "./TenantPaymentSchedulePanel.jsx";

function render(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  return { container, root };
}

describe("PaymentFrequencyPicker", () => {
  let mounted;
  afterEach(() => { if (mounted) { act(() => mounted.root.unmount()); mounted.container.remove(); mounted = null; } });

  it("offers weekly, bi-weekly, and monthly in plain English", () => {
    mounted = render(<PaymentFrequencyPicker />);
    const options = [...mounted.container.querySelectorAll("option")].map((option) => option.value);
    expect(options).toEqual(["monthly", "biweekly", "weekly"]);
    expect(mounted.container.textContent).toContain("52 payments a year");
  });
  it("defaults to monthly", () => {
    mounted = render(<PaymentFrequencyPicker />);
    expect(mounted.container.querySelector("select").value).toBe("monthly");
  });
  it("describes each frequency", () => {
    expect(paymentFrequencyDescription("weekly")).toContain("52 payments a year");
    expect(paymentFrequencyDescription("biweekly")).toContain("26 payments a year");
    expect(paymentFrequencyDescription("monthly")).toContain("12 payments a year");
    expect(paymentFrequencyDescription("bogus")).toContain("12 payments a year");
  });
});

describe("TenantPaymentSchedulePanel", () => {
  let mounted;
  afterEach(() => { if (mounted) { act(() => mounted.root.unmount()); mounted.container.remove(); mounted = null; } });
  const cadence = { frequency: "biweekly", frequencyLabel: "Paid every two weeks — 26 payments a year",
    perPaymentCents: 73846, nextDueDate: "2026-10-02" };

  it("renders nothing without a billing cadence", () => {
    mounted = render(<TenantPaymentSchedulePanel leaseId="lease_1" billingCadence={null} />);
    expect(mounted.container.textContent).toBe("");
  });
  it("shows the cadence in plain English with the per-payment amount and next due date", () => {
    mounted = render(<TenantPaymentSchedulePanel leaseId="lease_1" billingCadence={cadence} />);
    const text = mounted.container.textContent;
    expect(text).toContain("Paid every two weeks — 26 payments a year");
    expect(text).toContain("$738.46");
    expect(text).toContain("Oct 2, 2026");
  });
  it("posts the change and reloads the portal on success", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const onChanged = vi.fn(async () => undefined);
      mounted = render(<TenantPaymentSchedulePanel leaseId="lease_1" billingCadence={cadence} onChanged={onChanged} />);
      act(() => mounted.container.querySelector("button").click()); // "Change payment schedule"
      const select = mounted.container.querySelector("select[name='paymentFrequency']");
      expect(select).toBeTruthy();
      await act(async () => {
        select.value = "weekly";
        mounted.container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
      expect(fetchMock).toHaveBeenCalledWith("/api/rental/portal", expect.objectContaining({ method: "POST" }));
      const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(sent).toEqual({ operation: "change-payment-frequency", leaseId: "lease_1", paymentFrequency: "weekly" });
      expect(onChanged).toHaveBeenCalled();
      expect(mounted.container.textContent).toContain("landlord has been notified");
    } finally { vi.unstubAllGlobals(); }
  });
  it("shows the server error when the change is rejected", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, json: async () => ({ error: "The landlord has disabled payment schedule changes in the portal." }) }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      mounted = render(<TenantPaymentSchedulePanel leaseId="lease_1" billingCadence={cadence} />);
      act(() => mounted.container.querySelector("button").click());
      await act(async () => {
        mounted.container.querySelector("select[name='paymentFrequency']").value = "weekly";
        mounted.container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
      expect(mounted.container.textContent).toContain("disabled payment schedule changes");
    } finally { vi.unstubAllGlobals(); }
  });
});
