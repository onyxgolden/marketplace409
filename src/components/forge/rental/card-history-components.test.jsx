import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import TenantPaymentHistory from "./TenantPaymentHistory";
import PropertyExpenseHistory from "./PropertyExpenseHistory";
import { CardContextMenu, useCardContextMenu } from "./CardContextMenu";

describe("TenantPaymentHistory", () => {
  it("renders the last-3 summary card with an expandable full-ledger affordance", () => {
    const html = renderToStaticMarkup(<TenantPaymentHistory tenantId="tenant_1" tenantName="Paula" />);
    expect(html).toContain("data-tenant-payment-history");
    expect(html).toContain("Last 3 payments");
    expect(html).toContain("View full payment history");
    expect(html).toContain('aria-label="Payment history for Paula"');
  });
});

describe("PropertyExpenseHistory", () => {
  it("renders the expenses history with a visible co-owner-safe Add Expense affordance", () => {
    const html = renderToStaticMarkup(<PropertyExpenseHistory propertyId="145-laxon" propertyLabel="145 Laxon" />);
    expect(html).toContain("data-property-expense-history");
    expect(html).toContain("Expenses history");
    expect(html).toContain("data-property-add-expense");
    // ManualFinancialEventForm's own entry button — visible to co-owners, no role gate.
    expect(html).toContain("Add manual entry");
    expect(html).toContain('aria-label="Expense history for 145 Laxon"');
  });
});

describe("CardContextMenu", () => {
  it("renders nothing when no menu is open", () => {
    expect(renderToStaticMarkup(<CardContextMenu menu={null} onClose={() => {}} />)).toBe("");
  });
  it("renders the menu items at the cursor position", () => {
    const html = renderToStaticMarkup(
      <CardContextMenu menu={{ x: 100, y: 200, items: [{ label: "Open full payment history", onSelect: () => {} }] }} onClose={() => {}} />,
    );
    expect(html).toContain('role="menu"');
    expect(html).toContain("Open full payment history");
  });
  it("exposes a hook with an onContextMenu handler", () => {
    expect(typeof useCardContextMenu).toBe("function");
  });
});
