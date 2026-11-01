// @vitest-environment jsdom
// Controls-sweep follow-up G18 (M-24): every reconciliation row reaches
// its payment. There is no per-payment deep link in the app (record-param
// types are property/tenant/unit), so each row links to the Rent & payments
// surface, which lists the payment by the id shown in the row.
import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { clearSWRCache, fetchWithDedupe } from "../../../hooks/swrCache";
import RentalReconciliationPanel from "./RentalReconciliationPanel.jsx";

beforeEach(() => { clearSWRCache(); });

describe("RentalReconciliationPanel follow-up G18", () => {
  it("M-24: every row — attention, awaiting-settlement, and settled — links to Rent & payments", async () => {
    await fetchWithDedupe("rental:reconciliation", () => Promise.resolve({
      payments: [
        { id: "pay_failed", provider: "stripe", status: "failed", amount_cents: 185000 },
        { id: "pay_disputed", provider: "stripe", status: "disputed", amount_cents: 185000 },
        { id: "pay_waiting", provider: "stripe", status: "succeeded", amount_cents: 185000 },
        { id: "pay_offline", provider: "offline", status: "succeeded", amount_cents: 180000 },
      ],
      settlements: [],
    }));
    const html = renderToStaticMarkup(<RentalReconciliationPanel />);
    for (const id of ["pay_failed", "pay_disputed", "pay_waiting", "pay_offline"]) {
      expect(html).toContain(id);
      expect(html).toContain(`aria-label="View payment ${id} in Rent &amp; payments"`);
    }
    expect(html).toContain("href=\"/forge/rental?section=charges\"");
    expect(html).toContain("Needs attention — act on this payment there.");
    expect(html).toContain("Stripe has not settled this payment yet — no action needed.");
  });

  it("M-24: the panel stays read-only — the action is navigation, not a confirm flow", async () => {
    await fetchWithDedupe("rental:reconciliation", () => Promise.resolve({
      payments: [{ id: "pay_1", provider: "stripe", status: "failed", amount_cents: 185000 }],
      settlements: [],
    }));
    const html = renderToStaticMarkup(<RentalReconciliationPanel />);
    expect(html).not.toContain("CONFIRM");
    expect(html).not.toContain("<button");
  });
});
