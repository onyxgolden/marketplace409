// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearSWRCache } from "../../../hooks/swrCache";
import RentalDepositsPanel, { depositIdentity, leasePickerLabel } from "./RentalDepositsPanel";

// Each test starts with a clean SWR cache: the panel seeds parent-supplied
// initialData into the shared cache (first writer wins), so sequential
// renders with different fixtures must not leak entries across tests.
beforeEach(() => { clearSWRCache(); });
afterEach(() => { clearSWRCache(); });

const baseData = {
  deposits: [
    { id: "dep_1", lease_id: "lease_1", tenant_id: "tenant_1", required_amount_cents: 150000, status: "required", jurisdiction_code: "TX" },
  ],
  transactions: [
    { id: "txn_1", deposit_id: "dep_1", transaction_type: "received", amount_cents: 150000, occurred_at: "2026-10-13T12:00:00Z" },
  ],
  schedules: [
    { id: "sched_1", lease_id: "lease_1" },
    { id: "sched_2", lease_id: "lease_1" },
    { id: "sched_3", lease_id: "lease_2" },
    { id: "sched_4", lease_id: "lease_orphan" },
  ],
  tenants: [
    { id: "tenant_1", display_name: "Steven Crabtree" },
    { id: "tenant_2", display_name: "Eric Carrillo" },
  ],
  units: [
    { id: "unit_1", label: "4225 Barnhill" },
    { id: "unit_2", label: "308 Paula" },
  ],
  leases: [
    { id: "lease_1", unit_id: "unit_1", status: "draft" },
    { id: "lease_2", unit_id: "unit_2", status: "active" },
  ],
  leaseMemberships: [
    { lease_id: "lease_1", tenant_id: "tenant_1", occupancy_role: "primary" },
    { lease_id: "lease_2", tenant_id: "tenant_2", occupancy_role: "primary" },
  ],
};

const orphanData = {
  ...baseData,
  deposits: [
    { id: "dep_orphan", lease_id: "lease_orphan", tenant_id: "tenant_ghost", required_amount_cents: 90000, status: "required", jurisdiction_code: null },
  ],
  transactions: [],
};

function mountPanel(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(ui); });
  return { container, root };
}

describe("RentalDepositsPanel deposit labels", () => {
  it("shows the tenant name and property on the deposit row", () => {
    const markup = renderToStaticMarkup(<RentalDepositsPanel initialData={baseData} />);
    expect(markup).toContain("$1,500.00");
    expect(markup).toContain("Steven Crabtree — 4225 Barnhill · required · TX");
  });

  it("shows the tenant name and property on the selected deposit detail", () => {
    // Single-deposit fixture: the identity string occurs once in the row
    // subtitle and once in the detail header — two occurrences proves both.
    const markup = renderToStaticMarkup(<RentalDepositsPanel initialData={baseData} />);
    expect(markup).toContain("$1,500.00 required");
    expect((markup.match(/Steven Crabtree — 4225 Barnhill/g) || []).length).toBe(2);
  });

  it("labels the lease picker with property and tenant, one option per lease, and falls back to the raw id", () => {
    const { container, root } = mountPanel(<RentalDepositsPanel initialData={baseData} />);
    try {
      const toggle = [...container.querySelectorAll("button")].find((button) => button.textContent === "Add deposit requirement");
      expect(toggle).toBeTruthy();
      act(() => { toggle.click(); });
      const options = [...container.querySelectorAll("select[name=leaseId] option")].map((option) => option.textContent);
      expect(options).toContain("4225 Barnhill — Steven Crabtree");
      expect(options).toContain("308 Paula — Eric Carrillo");
      expect(options).toContain("lease_orphan");
      expect(options.filter((text) => text === "4225 Barnhill — Steven Crabtree").length).toBe(1);
    } finally {
      act(() => { root.unmount(); });
      container.remove();
    }
  });

  it("falls back to the raw lease id when no join resolves, never a blank label", () => {
    const markup = renderToStaticMarkup(<RentalDepositsPanel initialData={orphanData} />);
    expect(markup).toContain("lease_orphan · required · jurisdiction not recorded");
    expect(leasePickerLabel("lease_orphan", orphanData)).toBe("lease_orphan");
    expect(depositIdentity(orphanData.deposits[0], orphanData).label).toBe("lease_orphan");
  });

  it("shows whatever part resolves when only one join resolves", () => {
    const tenantOnly = { ...baseData, deposits: [{ id: "dep_x", lease_id: "lease_gone", tenant_id: "tenant_1", required_amount_cents: 10000, status: "required", jurisdiction_code: null }] };
    expect(depositIdentity(tenantOnly.deposits[0], tenantOnly).label).toBe("Steven Crabtree");
    expect(leasePickerLabel("lease_1", baseData)).toBe("4225 Barnhill — Steven Crabtree");
  });
});
