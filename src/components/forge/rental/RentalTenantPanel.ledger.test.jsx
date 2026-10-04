// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import RentalTenantPanel from "./RentalTenantPanel";

const tenants = [{ id: "t1", display_name: "Paula", email: "paula@example.com", status: "active" }];
const rentalPayload = {
  tenants,
  leases: [{ id: "l1", unit_id: "u1", status: "active" }],
  leaseMemberships: [{ tenant_id: "t1", lease_id: "l1", occupancy_role: "primary" }],
  units: [{ id: "u1", label: "145 Laxon — Unit A", status: "active" }],
  openCharges: [{ lease_id: "l1", amount_cents: 127500, paid_amount_cents: 0 }],
};
const ledgerPayload = {
  tenant: { id: "t1", display_name: "Paula" },
  ledger: {
    entries: [
      { id: "charge:c1", kind: "charge", date: "2026-09-01", amountCents: 127500, balanceEffectCents: 127500,
        label: "Rent charge", status: "open", method: null, period: "2026-09", leaseId: "l1",
        propertyLabel: "145 Laxon", unitLabel: "Unit A", reference: "c1", balanceAfterCents: 127500, rentecEvidence: [] },
    ],
    last3: [], unassigned: [],
    totals: { chargedCents: 127500, paidCents: 0, refundedCents: 0 },
    balanceCents: 127500,
  },
  deposits: { entries: [], heldCents: 0, requiredCents: 0 },
  openCharges: [
    { id: "c1", period: "2026-09", dueDate: "2026-09-01", chargeType: "rent", amountCents: 127500, paidCents: 0, remainingCents: 127500, status: "open" },
  ],
};

function stubFetch() {
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    if (String(url).includes("tenant-ledger")) return { ok: true, json: async () => ledgerPayload };
    return { ok: true, json: async () => rentalPayload };
  }));
}

describe("RentalTenantPanel tenant ledger access", () => {
  let container;
  let root;

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    container = null;
    root = null;
    vi.unstubAllGlobals();
  });

  async function mount({ recordContext = null, onNavigate = null } = {}) {
    stubFetch();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<RentalTenantPanel initialTenants={tenants} recordContext={recordContext} onNavigate={onNavigate} />));
    return container;
  }

  it("renders the index as a pure list with no tenant preview panel", async () => {
    await mount();
    // Index mode: the tenant table is the whole surface; record data lives on
    // the dedicated record page, never in a preview sidebar.
    expect(container.querySelector("[data-rental-tenant-setup]")).not.toBeNull();
    expect(container.querySelector("[data-rental-tenant-record]")).toBeNull();
    expect(container.querySelector("[data-rental-tenant-detail]")).toBeNull();
    const rows = [...container.querySelectorAll('tr[role="button"]')].filter((r) => r.textContent.includes("Paula"));
    expect(rows.length).toBe(1);
  });

  it("clicking a tenant row navigates to the dedicated tenant record page", async () => {
    const onNavigate = vi.fn();
    await mount({ onNavigate });
    const row = [...container.querySelectorAll('tr[role="button"]')].find((r) => r.textContent.includes("Paula"));
    act(() => row.click());
    expect(onNavigate).toHaveBeenCalledWith("tenants", expect.objectContaining({
      recordType: "tenant", recordId: "t1", recordLabel: "Paula",
    }));
  });

  it("the record page shows a back link to the tenant list", async () => {
    const onNavigate = vi.fn();
    await mount({ recordContext: { recordType: "tenant", recordId: "t1" }, onNavigate });
    expect(container.querySelector("[data-rental-tenant-record]")).not.toBeNull();
    expect(container.querySelector("[data-rental-tenant-detail]")).not.toBeNull();
    const back = [...container.querySelectorAll("button")].find((b) => b.textContent === "← Tenants");
    expect(back).not.toBeUndefined();
    act(() => back.click());
    expect(onNavigate).toHaveBeenCalledWith("tenants");
  });

  it("an unknown tenant record id falls back to the index with a notice", async () => {
    await mount({ recordContext: { recordType: "tenant", recordId: "nope" } });
    expect(container.querySelector("[data-rental-tenant-setup]")).not.toBeNull();
    expect(container.querySelector("[data-rental-tenant-record]")).toBeNull();
    expect(container.textContent).toContain("wasn't found");
  });

  it("opens the tenant record on the Tenant details tab first, with the ledger one click away", async () => {
    await mount({ recordContext: { recordType: "tenant", recordId: "t1" } });
    // Details-first (Rentec parity): the info panel renders on record open, not the ledger.
    const tabs = [...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
    expect(tabs).toEqual(["Tenant details", "Ledger"]);
    expect(container.querySelector('[data-record-tab="details"]').getAttribute("aria-selected")).toBe("true");
    expect(container.textContent).toContain("Primary tenant");
    // The ledger lives on the second tab.
    expect(container.querySelector("[data-tenant-ledger-page]")).toBeNull();
    await act(async () => { container.querySelector('[data-record-tab="ledger"]').click(); });
    expect(container.querySelector('[data-record-tab="ledger"]').getAttribute("aria-selected")).toBe("true");
    const ledger = container.querySelector("[data-tenant-ledger-page]");
    expect(ledger).not.toBeNull();
    expect(ledger.textContent).toContain("Paula");
    // The ledger tab's breadcrumb returns to the details tab.
    const crumb = [...ledger.querySelectorAll("button")].find((b) => b.textContent === "Tenant details");
    expect(crumb).not.toBeUndefined();
    await act(async () => { crumb.click(); });
    expect(container.querySelector('[data-record-tab="details"]').getAttribute("aria-selected")).toBe("true");
  });

  it("renders the tenant balance as a link in the list that opens the full-page ledger", async () => {
    await mount();
    const balanceLink = container.querySelector('button[aria-label^="View the full ledger"]');
    expect(balanceLink).not.toBeNull();
    expect(balanceLink.textContent).toContain("$1,275.00");
    expect(balanceLink.querySelector("strong").className).toContain("text-red-700");
    await act(async () => balanceLink.click());
    expect(container.querySelector("[data-tenant-ledger-page]")).not.toBeNull();
    expect(container.querySelector("[data-tenant-ledger-page]").textContent).toContain("Paula");
    // The Tenants breadcrumb closes the overlay back to the tenant index.
    const back = [...container.querySelectorAll("button")].find((b) => b.textContent === "Tenants");
    await act(async () => back.click());
    expect(container.querySelector("[data-tenant-ledger-page]")).toBeNull();
    expect(container.querySelector("[data-rental-tenant-setup]")).not.toBeNull();
  });

  it("right-clicking a tenant row opens the row menu with ledger, details, property and posting actions", async () => {
    const onNavigate = vi.fn();
    await mount({ onNavigate });
    // Paula (t1) has an active lease on unit u1, so View Property appears.
    const row = [...container.querySelectorAll('tr[role="button"]')].find((r) => r.textContent.includes("Paula"));
    expect(row).not.toBeUndefined();
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 80, clientY: 90 });
    act(() => row.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    const menu = container.querySelector('[role="menu"]');
    expect(menu).not.toBeNull();
    for (const label of ["View Ledger", "Tenant Details", "View Property", "Post Income", "Post Charge", "Print Statement"]) {
      expect(menu.textContent).toContain(label);
    }
    // Tenant Details navigates to the dedicated record page.
    const details = [...container.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent === "Tenant Details");
    await act(async () => details.click());
    expect(onNavigate).toHaveBeenCalledWith("tenants", expect.objectContaining({ recordType: "tenant", recordId: "t1" }));
  });

  it("right-clicking the tenant record opens the custom menu without a Tenant Details item and suppresses the native menu", async () => {
    await mount({ recordContext: { recordType: "tenant", recordId: "t1" } });
    const card = container.querySelector("[data-rental-tenant-detail]");
    expect(card).not.toBeNull();
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 80, clientY: 90 });
    act(() => card.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    const menu = container.querySelector('[role="menu"]');
    expect(menu).not.toBeNull();
    for (const label of ["View Ledger", "Post Income", "Post Charge", "Print Statement"]) {
      expect(menu.textContent).toContain(label);
    }
    // Already on the record: no self-link.
    expect(menu.textContent).not.toContain("Tenant Details");
  });

  it("the ⋮ button opens the same menu", async () => {
    await mount({ recordContext: { recordType: "tenant", recordId: "t1" } });
    const dots = container.querySelector('button[aria-label^="More actions"]');
    expect(dots).not.toBeNull();
    await act(async () => dots.click());
    const menu = container.querySelector('[role="menu"]');
    expect(menu).not.toBeNull();
    expect(menu.textContent).toContain("View Ledger");
    expect(menu.textContent).not.toContain("Tenant Details");
  });

  it("choosing View Ledger from the menu opens the full-page ledger", async () => {
    await mount({ recordContext: { recordType: "tenant", recordId: "t1" } });
    const card = container.querySelector("[data-rental-tenant-detail]");
    act(() => card.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 80, clientY: 90 })));
    const viewLedger = [...container.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent === "View Ledger");
    await act(async () => viewLedger.click());
    expect(container.querySelector("[data-tenant-ledger-page]")).not.toBeNull();
  });

  it("the details tab's own Open full ledger button opens the full-page ledger", async () => {
    await mount({ recordContext: { recordType: "tenant", recordId: "t1" } });
    // Details is the default tab; its payment history carries an Open full ledger button.
    const inline = [...container.querySelectorAll("button")].find((b) => b.textContent === "Open full ledger");
    expect(inline).not.toBeUndefined();
    await act(async () => inline.click());
    expect(container.querySelector("[data-tenant-ledger-page]")).not.toBeNull();
  });
});
