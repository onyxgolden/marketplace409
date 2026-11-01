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

describe("RentalTenantPanel controls sweep — G5 claimed-tenant email form", () => {
  function claimedDataset() {
    const tenant_primary = { id: "tenant_primary", display_name: "Steven Crabtree", email: "s@example.com", auth_user_id: "auth_1" };
    const tenant_other = { id: "tenant_other", display_name: "Jessica Crabtree", email: "j@example.com" };
    return {
      tenants: [tenant_primary, tenant_other],
      leases: [{ id: "lease_1", unit_id: "unit_1", property_id: "4225-barnhill", status: "active", monthly_rent_cents: 180000, rent_due_day: 1, start_date: "2026-10-13" }],
      leaseMemberships: [{ id: "membership_primary", lease_id: "lease_1", tenant_id: "tenant_primary", role: "primary" }],
      units: [{ id: "unit_1", label: "4225 Barnhill", property_id: "4225-barnhill" }],
      openCharges: [],
    };
  }

  it("hides the email form and explains for a portal-claimed tenant", async () => {
    const dataset = claimedDataset();
    vi.stubGlobal("fetch", vi.fn(async (url, options) => {
      if (String(url).includes("tenant-ledger")) return { ok: true, json: async () => emptyHistory };
      if (options?.method === "POST") return { ok: false, json: async () => ({ error: "unexpected operation" }) };
      return { ok: true, json: async () => dataset };
    }));
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<RentalTenantPanel initialTenants={dataset.tenants} recordContext={{ recordType: "tenant", recordId: "tenant_primary" }} />));
      expect(container.textContent).toContain("tied to their portal sign-in and cannot be changed from the landlord side");
      expect([...container.querySelectorAll("button")].some((candidate) => candidate.textContent === "Update email")).toBe(false);
    } finally {
      await act(async () => { root.unmount(); });
      container.remove();
    }
  });
});
