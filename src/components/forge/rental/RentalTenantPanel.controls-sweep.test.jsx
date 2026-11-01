// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import RentalTenantPanel from "./RentalTenantPanel";
import { invalidate } from "@/hooks/swrCache";

const emptyHistory = { ledger: { entries: [], last3: [], unassigned: [], totals: { chargedCents: 0, paidCents: 0, refundedCents: 0 }, balanceCents: 0 }, deposits: { entries: [], heldCents: 0, requiredCents: 0 } };

describe("RentalTenantPanel controls sweep — G1 cancelled-lease membership guard", () => {
  let container;
  let root;

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    invalidate("rental:tenants");
    vi.unstubAllGlobals();
  });

  async function flush() {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }

  async function mountRecord(dataset, recordId) {
    vi.stubGlobal("fetch", vi.fn(async (url, options) => {
      if (String(url).includes("tenant-ledger")) return { ok: true, json: async () => emptyHistory };
      if (options?.method === "POST") return { ok: false, json: async () => ({ error: "unexpected operation" }) };
      return { ok: true, json: async () => dataset };
    }));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<RentalTenantPanel initialTenants={dataset.tenants} recordContext={{ recordType: "tenant", recordId }} />));
    await flush();
    return container;
  }

  function buttonsNamed(text) {
    return [...container.querySelectorAll("button")].filter((button) => button.textContent === text);
  }

  it("hides make-primary, remove, and add co-tenant on a cancelled lease and explains why", async () => {
    const dataset = {
      tenants: [
        { id: "tenant_primary", display_name: "Primary Person", email: "primary@example.com" },
        { id: "tenant_co", display_name: "Co Person", email: "co@example.com" },
        { id: "tenant_other", display_name: "Other Person", email: "other@example.com" },
      ],
      leases: [{ id: "lease_1", unit_id: "unit_1", status: "cancelled", monthly_rent_cents: 180000 }],
      leaseMemberships: [
        { lease_id: "lease_1", tenant_id: "tenant_primary", occupancy_role: "primary" },
        { lease_id: "lease_1", tenant_id: "tenant_co", occupancy_role: "co_tenant" },
      ],
      units: [{ id: "unit_1", label: "4225 Barnhill" }],
      openCharges: [],
    };
    await mountRecord(dataset, "tenant_primary");
    expect(container.textContent).toContain("This lease is cancelled — membership cannot be changed.");
    expect(buttonsNamed("Make primary tenant")).toHaveLength(0);
    expect(buttonsNamed("Remove co-tenant")).toHaveLength(0);
    expect(buttonsNamed("Add co-tenant")).toHaveLength(0);
  });

  it("keeps the membership controls on an active lease", async () => {
    const dataset = {
      tenants: [
        { id: "tenant_primary", display_name: "Primary Person", email: "primary@example.com" },
        { id: "tenant_co", display_name: "Co Person", email: "co@example.com" },
        { id: "tenant_other", display_name: "Other Person", email: "other@example.com" },
      ],
      leases: [{ id: "lease_1", unit_id: "unit_1", status: "active", monthly_rent_cents: 180000 }],
      leaseMemberships: [
        { lease_id: "lease_1", tenant_id: "tenant_primary", occupancy_role: "primary" },
        { lease_id: "lease_1", tenant_id: "tenant_co", occupancy_role: "co_tenant" },
      ],
      units: [{ id: "unit_1", label: "4225 Barnhill" }],
      openCharges: [],
    };
    await mountRecord(dataset, "tenant_primary");
    expect(container.textContent).not.toContain("membership cannot be changed");
    expect(buttonsNamed("Remove co-tenant")).toHaveLength(1);
    expect(buttonsNamed("Add co-tenant")).toHaveLength(1);
  });
});
