// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import RentalTenantPanel from "./RentalTenantPanel";

const tenants = [
  { id: "tenant_1", display_name: "Ashley George", email: "ashley@example.com" },
  { id: "tenant_2", display_name: "Justin Graham", email: "justin@example.com" },
];

describe("RentalTenantPanel tenant selection", () => {
  let container;
  let root;

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    vi.unstubAllGlobals();
  });

  it("shows the selected tenant's own portal email", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ tenants, leases: [], leaseMemberships: [], units: [], openCharges: [] }) })));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<RentalTenantPanel initialTenants={tenants} />));

    expect(container.querySelector('input[name="portalEmail"]').value).toBe("ashley@example.com");
    const justinRow = [...container.querySelectorAll('tr[role="button"]')].find((row) => row.textContent.includes("Justin Graham"));
    act(() => justinRow.click());

    expect(container.querySelector('input[name="portalEmail"]').value).toBe("justin@example.com");
    expect(container.querySelector('input[name="portalEmail"]').getAttribute("aria-label")).toBe("Portal email for Justin Graham");
  });

  it("opens the newly saved tenant and shows an unmistakable success message", async () => {
    const paula = { id: "tenant_3", display_name: "Paula Welch", displayName: "Paula Welch", email: "paula@example.com" };
    let savedTenants = tenants;
    const emptyHistory = { ledger: { entries: [], last3: [], unassigned: [], totals: { chargedCents: 0, paidCents: 0, refundedCents: 0 }, balanceCents: 0 }, deposits: { entries: [], heldCents: 0, requiredCents: 0 } };
    const fetch = vi.fn(async (url, options) => {
      // URL-routed: the tenant card also fetches its payment history on mount.
      if (String(url).includes("tenant-ledger")) return { ok: true, json: async () => emptyHistory };
      if (options?.method === "POST") {
        savedTenants = [...tenants, paula];
        return { ok: true, json: async () => ({ tenant: paula }) };
      }
      return { ok: true, json: async () => ({ tenants: savedTenants, leases: [], leaseMemberships: [], units: [], openCharges: [] }) };
    });
    vi.stubGlobal("fetch", fetch);
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => root.render(<RentalTenantPanel initialTenants={tenants} />));
    act(() => [...container.querySelectorAll("button")].find((button) => button.textContent.includes("Add a new tenant")).click());
    const form = container.querySelector('input[name="displayName"]').form;
    container.querySelector('input[name="displayName"]').value = "Paula Welch";
    container.querySelector('input[name="email"]').value = "paula@example.com";
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(container.textContent).toContain("New tenant added: Paula Welch");
    expect(container.querySelector('input[name="portalEmail"]').value).toBe("paula@example.com");
    expect(container.querySelector('input[name="displayName"]')).toBeNull();
  });
});
