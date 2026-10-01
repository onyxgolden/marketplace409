// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import RentalTerminologyPanel from "./RentalTerminologyPanel.jsx";
import { RentalTerminologyProvider } from "./rentalTerminologyContext.jsx";

function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(ui); });
  return { container, root };
}
async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

describe("RentalTerminologyPanel", () => {
  let mounted;
  afterEach(() => {
    if (mounted) {
      act(() => { mounted.root.unmount(); });
      mounted.container.remove();
      mounted = null;
    }
    vi.restoreAllMocks();
  });

  it("shows a live preview that updates as terms are typed", async () => {
    mounted = mount(
      <RentalTerminologyProvider>
        <RentalTerminologyPanel />
      </RentalTerminologyProvider>,
    );
    await flush();
    const preview = mounted.container.querySelector('[aria-label="Navigation preview"]');
    expect(preview.textContent).toContain("Tenants");
    const singular = mounted.container.querySelector('input[placeholder="tenant"]');
    act(() => {
      singular.focus();
      // React 18 controlled input: set the native value then fire input.
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      nativeSetter.call(singular, "resident");
      singular.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const plural = mounted.container.querySelector('input[placeholder="tenants"]');
    act(() => {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      nativeSetter.call(plural, "residents");
      plural.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();
    expect(mounted.container.querySelector('[aria-label="Navigation preview"]').textContent).toContain("Residents");
    expect(mounted.container.textContent).toContain("Assign this lease to the resident and email the owner a copy.");
    expect(mounted.container.textContent).toContain("Residents with unpaid balances appear at the top of the rent roll.");
  });

  it("blocks save when a term is empty and shows the validation error", async () => {
    const fetchSpy = vi.spyOn(window, "fetch").mockRejectedValue(new Error("no network"));
    mounted = mount(
      <RentalTerminologyProvider>
        <RentalTerminologyPanel />
      </RentalTerminologyProvider>,
    );
    await flush();
    const singular = mounted.container.querySelector('input[placeholder="tenant"]');
    act(() => {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      nativeSetter.call(singular, "");
      singular.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();
    const form = mounted.container.querySelector("form");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();
    const alert = mounted.container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert.textContent).toMatch(/cannot be empty/);
    expect(fetchSpy).not.toHaveBeenCalledWith("/api/rental/terminology", expect.objectContaining({ method: "POST" }));
  });

  it("saves through the API and reports success", async () => {
    const payload = {
      terms: {
        tenant: { singular: "resident", plural: "residents" },
        property: { singular: "property", plural: "properties" },
        lease: { singular: "lease", plural: "leases" },
        owner: { singular: "owner", plural: "owners" },
        vendor: { singular: "vendor", plural: "vendors" },
      },
    };
    const fetchSpy = vi.spyOn(window, "fetch").mockImplementation((url, options) => {
      if (options?.method === "POST") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, terms: payload.terms }) });
      }
      return Promise.reject(new Error("no network"));
    });
    mounted = mount(
      <RentalTerminologyProvider>
        <RentalTerminologyPanel />
      </RentalTerminologyProvider>,
    );
    await flush();
    const singular = mounted.container.querySelector('input[placeholder="tenant"]');
    act(() => {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      nativeSetter.call(singular, "resident");
      singular.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const plural = mounted.container.querySelector('input[placeholder="tenants"]');
    act(() => {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      nativeSetter.call(plural, "residents");
      plural.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();
    const form = mounted.container.querySelector("form");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();
    const postCalls = fetchSpy.mock.calls.filter(([, options]) => options?.method === "POST");
    expect(postCalls).toHaveLength(1);
    const sent = JSON.parse(postCalls[0][1].body);
    expect(sent.terms.tenant).toEqual({ singular: "resident", plural: "residents" });
    expect(mounted.container.querySelector('[role="status"]').textContent).toMatch(/Terminology saved/);
  });
});
