// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import RentalTenantPanel from "./RentalTenantPanel";
import { invalidate } from "@/hooks/swrCache";

const emptyHistory = { ledger: { entries: [], last3: [], unassigned: [], totals: { chargedCents: 0, paidCents: 0, refundedCents: 0 }, balanceCents: 0 }, deposits: { entries: [], heldCents: 0, requiredCents: 0 } };

describe("RentalTenantPanel make-primary visibility", () => {
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

  function stubFetch(dataset, posts) {
    vi.stubGlobal("fetch", vi.fn(async (url, options) => {
      if (String(url).includes("tenant-ledger")) return { ok: true, json: async () => emptyHistory };
      if (options?.method === "POST") {
        const body = JSON.parse(options.body);
        posts.push(body);
        if (body.operation === "set-primary-tenant") return { ok: true, json: async () => ({ success: true }) };
        return { ok: false, json: async () => ({ error: "unexpected operation" }) };
      }
      return { ok: true, json: async () => dataset };
    }));
  }

  async function mountRecord(dataset, recordId) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<RentalTenantPanel initialTenants={dataset.tenants} recordContext={{ recordType: "tenant", recordId }} />));
    await flush();
    return container;
  }

  function makePrimaryButtons(scope) {
    return [...(scope || container).querySelectorAll("button")].filter((button) => button.textContent === "Make primary tenant");
  }

  it("shows Make primary on the fallback primary's card when the lease has no true primary, and clicking it calls set-primary-tenant", async () => {
    const dataset = {
      tenants: [
        { id: "tenant_steven", display_name: "Steven Crabtree", email: "steven@example.com" },
        { id: "tenant_other", display_name: "Other Person", email: "other@example.com" },
      ],
      leases: [{ id: "lease_1", unit_id: "unit_1", status: "draft", monthly_rent_cents: 180000 }],
      leaseMemberships: [{ lease_id: "lease_1", tenant_id: "tenant_steven", occupancy_role: "co_tenant" }],
      units: [{ id: "unit_1", label: "4225 Barnhill" }],
      openCharges: [],
    };
    const posts = [];
    stubFetch(dataset, posts);
    await mountRecord(dataset, "tenant_steven");

    // The stuck case: sole member is a co_tenant, so no co-tenant card exists
    // and the old code rendered no Make-primary button anywhere.
    const primaryCard = container.querySelector('section[aria-label="Primary tenant"]');
    expect(primaryCard).not.toBeNull();
    expect(makePrimaryButtons(primaryCard)).toHaveLength(1);
    expect(makePrimaryButtons()).toHaveLength(1);
    expect(container.textContent).toContain("No co-tenant is assigned to this lease.");

    await act(async () => { makePrimaryButtons(primaryCard)[0].click(); });
    await flush();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toEqual({ operation: "set-primary-tenant", leaseId: "lease_1", tenantId: "tenant_steven" });
    expect(container.textContent).toContain("Primary tenant updated.");
  });

  it("shows no new control on the Primary card when a true primary exists, and co-tenant buttons behave as before", async () => {
    const dataset = {
      tenants: [
        { id: "tenant_prim", display_name: "Prim Person", email: "prim@example.com" },
        { id: "tenant_co", display_name: "Co Person", email: "co@example.com" },
      ],
      leases: [{ id: "lease_1", unit_id: "unit_1", status: "draft", monthly_rent_cents: 180000 }],
      leaseMemberships: [
        { lease_id: "lease_1", tenant_id: "tenant_prim", occupancy_role: "primary" },
        { lease_id: "lease_1", tenant_id: "tenant_co", occupancy_role: "co_tenant" },
      ],
      units: [{ id: "unit_1", label: "4225 Barnhill" }],
      openCharges: [],
    };
    const posts = [];
    stubFetch(dataset, posts);
    await mountRecord(dataset, "tenant_prim");

    // Unchanged behavior: the Primary card carries no button; the co-tenant
    // card carries the only one.
    const primaryCard = container.querySelector('section[aria-label="Primary tenant"]');
    expect(primaryCard).not.toBeNull();
    expect(makePrimaryButtons(primaryCard)).toHaveLength(0);
    expect(makePrimaryButtons()).toHaveLength(1);

    await act(async () => { makePrimaryButtons()[0].click(); });
    await flush();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toEqual({ operation: "set-primary-tenant", leaseId: "lease_1", tenantId: "tenant_co" });
  });
});
