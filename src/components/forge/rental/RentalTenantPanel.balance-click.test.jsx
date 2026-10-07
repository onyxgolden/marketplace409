// @vitest-environment jsdom
// Regression test for the ChatGPT #552 NEEDS CHANGES finding (2026-10-06):
// clicking the "Active balance" cell opened the ledger AND bubbled to the
// tenant row, triggering tenant-record navigation. The button must stop
// propagation exactly like the Property link does.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import RentalTenantPanel from "./RentalTenantPanel";

const masterPayload = {
  tenants: [{ id: "tenant_1", display_name: "Test Tenant", email: "t@example.com" }],
  leases: [{ id: "lease_1", unit_id: "unit_1", status: "active" }],
  leaseMemberships: [{ lease_id: "lease_1", tenant_id: "tenant_1" }],
  units: [{ id: "unit_1", label: "Main residence" }],
  openCharges: [{ lease_id: "lease_1", amount_cents: 160000, paid_amount_cents: 0 }],
};

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => masterPayload })));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderPanel(onNavigate) {
  await act(async () => {
    root.render(
      <RentalTenantPanel initialTenants={masterPayload.tenants} onNavigate={onNavigate} />
    );
    // let the mocked /api/rental fetch resolve and the list re-render
    await Promise.resolve();
  });
  await act(async () => { await Promise.resolve(); });
}

describe("RentalTenantPanel active-balance click", () => {
  it("opens the ledger without navigating to the tenant record", async () => {
    const onNavigate = vi.fn();
    await renderPanel(onNavigate);

    const balanceButton = container.querySelector('button[aria-label^="View the full ledger for"]');
    expect(balanceButton).not.toBeNull();

    await act(async () => {
      balanceButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    const tenantRecordNavs = onNavigate.mock.calls.filter(
      ([target, context]) => target === "tenants" && context?.recordType === "tenant"
    );
    expect(tenantRecordNavs).toEqual([]);
  });

  it("still opens the ledger on balance click", async () => {
    const onNavigate = vi.fn();
    await renderPanel(onNavigate);

    const balanceButton = container.querySelector('button[aria-label^="View the full ledger for"]');
    await act(async () => {
      balanceButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    // the full-page ledger replaces the index surface on open
    expect(container.querySelector('button[aria-label^="View the full ledger for"]')).toBeNull();
  });
});
