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
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tenants, leases: [], leaseMemberships: [], units: [], openCharges: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tenant: paula }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tenants: [...tenants, paula], leases: [], leaseMemberships: [], units: [], openCharges: [] }) });
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
