import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import TenantDepositPanel, { heldDepositBalance } from "./TenantDepositPanel.jsx";
describe("TenantDepositPanel", () => {
  it("calculates the liability still held for the tenant", () => {
    expect(heldDepositBalance("d1", [{ depositId: "d1", transactionType: "received", amountCents: 200000 },
      { depositId: "d1", transactionType: "refunded", amountCents: 50000 }])).toBe(150000);
  });
  it("explains that a deposit is separate from rent", () => {
    const html = renderToStaticMarkup(<TenantDepositPanel rentals={[{ unit: { label: "Home" }, securityDeposits: [{ id: "d1", requiredAmountCents: 200000, status: "held" }], securityDepositTransactions: [] }]} />);
    expect(html).toContain("tracked separately from rent"); expect(html).toContain("$2,000.00");
  });
});
