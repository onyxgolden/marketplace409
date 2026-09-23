// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import AutopayPaymentNotice, { formatAutopayDateLabel, nextMonthlyChargeDate, pfAutopayNoticeKind, sameBillingMonth } from "./AutopayPaymentNotice.jsx";

function render(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  return { container, root };
}

describe("AutopayPaymentNotice", () => {
  let mounted;
  afterEach(() => { if (mounted) { act(() => mounted.root.unmount()); mounted.container.remove(); mounted = null; } });

  it("says autopay will not run when the payment covers the full scheduled amount", () => {
    mounted = render(<AutopayPaymentNotice coversAutopay autopayDateLabel="Sep 15" />);
    expect(mounted.container.textContent)
      .toContain("This payment covers your Sep 15 payment — your AutoPay won't run for that period.");
  });

  it("says the payment is in addition to autopay for a partial payment", () => {
    mounted = render(<AutopayPaymentNotice coversAutopay={false} autopayDateLabel="Oct 15" />);
    expect(mounted.container.textContent)
      .toContain("This payment will be in addition to your Oct 15 AutoPay payment.");
  });
});

describe("nextMonthlyChargeDate", () => {
  it("returns the charge day later this month when it has not passed", () => {
    expect(nextMonthlyChargeDate(15, new Date(Date.UTC(2026, 8, 10)))).toEqual(new Date(Date.UTC(2026, 8, 15)));
  });
  it("returns today when today is the charge day", () => {
    expect(nextMonthlyChargeDate(15, new Date(Date.UTC(2026, 8, 15)))).toEqual(new Date(Date.UTC(2026, 8, 15)));
  });
  it("rolls to next month when the charge day already passed", () => {
    expect(nextMonthlyChargeDate(15, new Date(Date.UTC(2026, 8, 23)))).toEqual(new Date(Date.UTC(2026, 9, 15)));
  });
  it("rolls December into January of the next year", () => {
    expect(nextMonthlyChargeDate(15, new Date(Date.UTC(2026, 11, 20)))).toEqual(new Date(Date.UTC(2027, 0, 15)));
  });
  it("formats the label like the notice shows it", () => {
    expect(formatAutopayDateLabel(new Date(Date.UTC(2026, 8, 15)))).toBe("Sep 15");
  });
  it("detects the same billing month on the UTC calendar the sweep uses", () => {
    expect(sameBillingMonth(new Date(Date.UTC(2026, 8, 15)), new Date(Date.UTC(2026, 8, 1)))).toBe(true);
    expect(sameBillingMonth(new Date(Date.UTC(2026, 9, 15)), new Date(Date.UTC(2026, 8, 30)))).toBe(false);
  });
});

describe("pfAutopayNoticeKind", () => {
  it("covers when the amount meets the scheduled payment and the next run is in the current month", () => {
    const result = pfAutopayNoticeKind({ amountCents: 51785, scheduledCents: 51785, chargeDay: 15, now: new Date(Date.UTC(2026, 8, 10)) });
    expect(result.kind).toBe("covers");
    expect(result.runDate).toEqual(new Date(Date.UTC(2026, 8, 15)));
  });
  it("is additional for a partial amount even when the run is this month", () => {
    const result = pfAutopayNoticeKind({ amountCents: 10000, scheduledCents: 51785, chargeDay: 15, now: new Date(Date.UTC(2026, 8, 10)) });
    expect(result.kind).toBe("additional");
    expect(result.runDate).toEqual(new Date(Date.UTC(2026, 8, 15)));
  });
  // The backend buckets settled payments by created-at month: a full payment made after this
  // month's charge day lands in a period with no upcoming run, so the next run still charges.
  it("is additional for a full amount when the next run is next month", () => {
    const result = pfAutopayNoticeKind({ amountCents: 51785, scheduledCents: 51785, chargeDay: 15, now: new Date(Date.UTC(2026, 8, 23)) });
    expect(result.kind).toBe("additional");
    expect(result.runDate).toEqual(new Date(Date.UTC(2026, 9, 15)));
  });
  it("is additional when no valid amount has been entered yet", () => {
    expect(pfAutopayNoticeKind({ amountCents: NaN, scheduledCents: 51785, chargeDay: 15, now: new Date(Date.UTC(2026, 8, 10)) }).kind)
      .toBe("additional");
  });
});
