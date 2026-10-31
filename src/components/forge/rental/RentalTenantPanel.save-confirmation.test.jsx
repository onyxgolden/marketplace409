// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import RentalTenantPanel from "./RentalTenantPanel";
import { clearSWRCache, seedCacheEntry } from "@/hooks/swrCache";

describe("RentalTenantPanel save confirmation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
    clearSWRCache();
  });

  it("shows a prominent Tenant saved banner on the record view after save", async () => {
    let tenants = [{ id: "t1", display_name: "Eric Carrillo", email: "eric@example.com", status: "active" }];
    vi.stubGlobal("fetch", vi.fn(async (url, options) => {
      if (url === "/api/rental" && options?.method === "POST") {
        const body = JSON.parse(options.body);
        if (body.operation === "save-tenant") {
          const saved = { id: "t2", display_name: body.tenant.displayName, displayName: body.tenant.displayName,
            email: body.tenant.email, status: "invited" };
          tenants = [...tenants, saved];
          return { ok: true, json: async () => ({ tenant: saved }) };
        }
        throw new Error(`unexpected POST ${body.operation}`);
      }
      if (url === "/api/rental") {
        return { ok: true, json: async () => ({ tenants, leases: [], leaseMemberships: [],
          units: [{ id: "u1", label: "4225 Barnhill" }], openCharges: [] }) };
      }
      if (typeof url === "string" && url.startsWith("/api/rental/custom-field-values")) {
        return { ok: true, json: async () => ({ fields: [], values: {} }) };
      }
      return { ok: true, json: async () => ({}) };
    }));

    clearSWRCache();
    seedCacheEntry("rental:tenants", { tenants, leases: [], leaseMemberships: [],
      units: [{ id: "u1", label: "4225 Barnhill" }], openCharges: [] });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let latestContext = null;
    const renderWith = (context) => {
      act(() => {
        root.render(<RentalTenantPanel recordContext={context}
          onNavigate={(fn, ctx) => { latestContext = ctx; renderWith(ctx); }} />);
      });
    };
    renderWith(null);
    // The adoption effect collapses the create form (tenants exist); reopen it.
    const addButton = [...container.querySelectorAll("button")].find((item) => item.textContent === "+ Add a new tenant");
    expect(addButton).toBeTruthy();
    act(() => { addButton.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const form = [...container.querySelectorAll("form")].find((item) => item.querySelector('input[name="displayName"]'));
    expect(form).toBeTruthy();
    form.querySelector('input[name="displayName"]').value = "Steven Crabtree";
    form.querySelector('input[name="email"]').value = "steven@example.com";
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    // The confirmation travels with the navigation to the new record.
    expect(latestContext?.notice).toBe("Tenant saved: Steven Crabtree");
    expect(container.textContent).toContain("Tenant saved: Steven Crabtree");
    expect(container.textContent).not.toContain("wasn't found");
    const banner = [...container.querySelectorAll('p[role="status"]')]
      .find((item) => item.textContent.includes("Tenant saved:"));
    expect(banner).toBeTruthy();
    expect(banner.className).toContain("border-emerald-300");
  });
});
