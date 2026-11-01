// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import TenantCreditSection from "./TenantCreditSection";

function setInput(input, value) {
  const proto = input instanceof window.HTMLSelectElement
    ? window.HTMLSelectElement.prototype
    : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event(input instanceof window.HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

function renderSection(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<TenantCreditSection credits={[]} creditApplications={[]} openCharges={[]} onChanged={vi.fn()} {...props} />));
  return { container, root };
}

describe("TenantCreditSection controls sweep — B4", () => {
  let container;
  let root;

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    container = null;
    root = null;
    vi.unstubAllGlobals();
  });

  it("renders the create-credit form when the tenant has no credits yet", () => {
    ({ container, root } = renderSection({ tenantId: "t1", tenantName: "Steven Crabtree", tenantLeases: [{ id: "lease_1", label: "4225 Barnhill" }] }));
    expect(container.textContent).toContain("No credits yet");
    expect(container.textContent).toContain("Create a credit…");
    act(() => { container.querySelector("button").click(); });
    // The first button in the section is the create toggle; the form follows.
    expect(container.textContent).toContain("Create a tenant credit");
    expect(container.querySelector('input[placeholder="0.00"]')).not.toBeNull();
    expect(container.textContent).toContain("A standalone credit");
  });

  it("shows a lease select only for multi-lease tenants", () => {
    ({ container, root } = renderSection({ tenantId: "t1", tenantLeases: [{ id: "lease_1" }, { id: "lease_2", label: "Second" }] }));
    act(() => { container.querySelector("button").click(); });
    expect(container.querySelector("select")).not.toBeNull();
    expect(container.textContent).toContain("Second");
  });

  it("explains when the tenant has no lease instead of offering a dead submit", () => {
    ({ container, root } = renderSection({ tenantId: "t1", tenantLeases: [] }));
    act(() => { container.querySelector("button").click(); });
    expect(container.textContent).toContain("create a lease first");
    const submit = [...container.querySelectorAll("button")].find((button) => button.textContent === "Create credit");
    expect(submit.disabled).toBe(true);
  });

  it("creates a credit and shows the emerald confirmation naming amount and tenant", async () => {
    const onChanged = vi.fn();
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ success: true, credit: { id: "credit_new" } }) }));
    vi.stubGlobal("fetch", fetchMock);
    ({ container, root } = renderSection({ tenantId: "t1", tenantName: "Steven Crabtree", tenantLeases: [{ id: "lease_1" }], onChanged }));
    act(() => { container.querySelector("button").click(); });
    setInput(container.querySelector('input[placeholder="0.00"]'), "50");
    setInput(container.querySelector('input[placeholder^="e.g. goodwill"]'), "Goodwill concession");
    act(() => { container.querySelector('input[type="checkbox"]').click(); });
    setInput(container.querySelector('input[placeholder="CONFIRM"]'), "CONFIRM");
    const submit = [...container.querySelectorAll("button")].find((button) => button.textContent === "Create credit");
    await act(async () => { submit.click(); });
    expect(fetchMock).toHaveBeenCalledOnce();
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.operation).toBe("create-tenant-credit");
    expect(sent.credit.tenantId).toBe("t1");
    expect(sent.credit.amountCents).toBe(5000);
    expect(sent.credit.reason).toBe("Goodwill concession");
    expect(sent.credit.ownerConfirmed).toBe(true);
    expect(container.querySelector('[role="status"]').textContent).toContain("Credit $50.00 recorded for Steven Crabtree");
    expect(onChanged).toHaveBeenCalled();
  });

  it("surfaces the server error instead of failing silently", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ error: "Tenant has no lease to attach this credit to." }) })));
    ({ container, root } = renderSection({ tenantId: "t1", tenantLeases: [{ id: "lease_1" }] }));
    act(() => { container.querySelector("button").click(); });
    setInput(container.querySelector('input[placeholder="0.00"]'), "25");
    setInput(container.querySelector('input[placeholder^="e.g. goodwill"]'), "Concession");
    act(() => { container.querySelector('input[type="checkbox"]').click(); });
    setInput(container.querySelector('input[placeholder="CONFIRM"]'), "CONFIRM");
    const submit = [...container.querySelectorAll("button")].find((button) => button.textContent === "Create credit");
    await act(async () => { submit.click(); });
    expect(container.querySelector('[role="alert"]').textContent).toContain("no lease to attach");
  });
});
