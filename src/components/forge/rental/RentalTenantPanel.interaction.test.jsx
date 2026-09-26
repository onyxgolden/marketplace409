// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import RentalTenantPanel from "./RentalTenantPanel";
import { invalidate } from "@/hooks/swrCache";

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
    invalidate("rental:tenants");
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

  it("opens an in-app delete confirmation and only deletes after typing DELETE", async () => {
    const duplicate = { id: "tenant_9", display_name: "Duplicate Sam", email: "sam@example.com" };
    let liveTenants = [duplicate];
    const emptyHistory = { ledger: { entries: [], last3: [], unassigned: [], totals: { chargedCents: 0, paidCents: 0, refundedCents: 0 }, balanceCents: 0 }, deposits: { entries: [], heldCents: 0, requiredCents: 0 } };
    const posts = [];
    const fetch = vi.fn(async (url, options) => {
      if (String(url).includes("tenant-ledger")) return { ok: true, json: async () => emptyHistory };
      if (options?.method === "POST") {
        const body = JSON.parse(options.body);
        posts.push(body);
        if (body.operation === "delete-unused-tenant" && body.confirmation === "DELETE") {
          liveTenants = liveTenants.filter((tenant) => tenant.id !== body.tenantId);
          return { ok: true, json: async () => ({ success: true, deletedTenant: duplicate }) };
        }
        return { ok: false, json: async () => ({ error: "unexpected operation" }) };
      }
      return { ok: true, json: async () => ({ tenants: liveTenants, leases: [], leaseMemberships: [], units: [], openCharges: [] }) };
    });
    vi.stubGlobal("fetch", fetch);
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => root.render(<RentalTenantPanel initialTenants={[duplicate]} />));

    const deleteButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "Delete unused duplicate");
    expect(deleteButton).not.toBeUndefined();
    act(() => deleteButton.click());

    // The confirmation is an in-DOM dialog (not window.confirm): no delete fires yet.
    const dialog = container.querySelector('[role="alertdialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain("Duplicate Sam");
    expect(posts).toHaveLength(0);

    // Typing anything other than DELETE keeps the confirm button disabled.
    const confirmInput = dialog.querySelector('input[name="deleteConfirmText"]');
    const setNativeValue = (input, value) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    act(() => setNativeValue(confirmInput, "delete"));
    expect(dialog.querySelector("button:last-child").disabled).toBe(true);
    act(() => setNativeValue(confirmInput, "DELETE"));
    expect(dialog.querySelector("button:last-child").disabled).toBe(false);

    await act(async () => dialog.querySelector("button:last-child").click());

    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ operation: "delete-unused-tenant", tenantId: "tenant_9", confirmation: "DELETE" });
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(container.textContent).toContain("Deleted unused duplicate: Duplicate Sam");
  });

  it("cancels the delete flow without touching the API", async () => {
    const duplicate = { id: "tenant_9", display_name: "Duplicate Sam", email: "sam@example.com" };
    const emptyHistory = { ledger: { entries: [], last3: [], unassigned: [], totals: { chargedCents: 0, paidCents: 0, refundedCents: 0 }, balanceCents: 0 }, deposits: { entries: [], heldCents: 0, requiredCents: 0 } };
    const posts = [];
    const fetch = vi.fn(async (url, options) => {
      if (String(url).includes("tenant-ledger")) return { ok: true, json: async () => emptyHistory };
      if (options?.method === "POST") { posts.push(JSON.parse(options.body)); return { ok: true, json: async () => ({}) }; }
      return { ok: true, json: async () => ({ tenants: [duplicate], leases: [], leaseMemberships: [], units: [], openCharges: [] }) };
    });
    vi.stubGlobal("fetch", fetch);
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => root.render(<RentalTenantPanel initialTenants={[duplicate]} />));

    act(() => [...container.querySelectorAll("button")].find((button) => button.textContent === "Delete unused duplicate").click());
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
    act(() => [...container.querySelector('[role="alertdialog"]').querySelectorAll("button")].find((button) => button.textContent === "Cancel").click());

    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(posts).toHaveLength(0);
  });

  it("gates the invite email behind a confirm naming the recipient — no send fires on click alone", async () => {
    const tenant = { id: "tenant_1", display_name: "Ashley George", email: "ashley@example.com" };
    const emptyHistory = { ledger: { entries: [], last3: [], unassigned: [], totals: { chargedCents: 0, paidCents: 0, refundedCents: 0 }, balanceCents: 0 }, deposits: { entries: [], heldCents: 0, requiredCents: 0 } };
    const posts = [];
    const fetch = vi.fn(async (url, options) => {
      if (String(url).includes("tenant-ledger")) return { ok: true, json: async () => emptyHistory };
      if (options?.method === "POST") { posts.push(JSON.parse(options.body)); return { ok: true, json: async () => ({}) }; }
      return { ok: true, json: async () => ({ tenants: [tenant], leases: [], leaseMemberships: [], units: [], openCharges: [] }) };
    });
    vi.stubGlobal("fetch", fetch);
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => root.render(<RentalTenantPanel initialTenants={[tenant]} />));

    const inviteButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "Send invite email");
    expect(inviteButton).not.toBeUndefined();
    act(() => inviteButton.click());

    // The confirm names the recipient and the consequence; no API call fires yet.
    const dialog = container.querySelector('[role="alertdialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain("Ashley George");
    expect(dialog.textContent).toContain("ashley@example.com");
    expect(dialog.textContent).toContain("sends a real email");
    expect(posts).toHaveLength(0);

    // The Send invite button stays disabled until the checkbox is checked AND INVITE is typed.
    const setNativeValue = (input, value) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const sendButton = [...dialog.querySelectorAll("button")].find((button) => button.textContent === "Send invite");
    expect(sendButton.disabled).toBe(true);
    act(() => dialog.querySelector('input[type="checkbox"]').click());
    expect(sendButton.disabled).toBe(true);
    act(() => setNativeValue(dialog.querySelector('input[name="inviteConfirmText"]'), "invite"));
    expect(sendButton.disabled).toBe(true);
    act(() => setNativeValue(dialog.querySelector('input[name="inviteConfirmText"]'), "INVITE"));
    expect(sendButton.disabled).toBe(false);

    await act(async () => sendButton.click());
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ operation: "send-tenant-invite", tenantId: "tenant_1" });
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("cancels the invite flow without sending anything", async () => {
    const tenant = { id: "tenant_1", display_name: "Ashley George", email: "ashley@example.com" };
    const emptyHistory = { ledger: { entries: [], last3: [], unassigned: [], totals: { chargedCents: 0, paidCents: 0, refundedCents: 0 }, balanceCents: 0 }, deposits: { entries: [], heldCents: 0, requiredCents: 0 } };
    const posts = [];
    const fetch = vi.fn(async (url, options) => {
      if (String(url).includes("tenant-ledger")) return { ok: true, json: async () => emptyHistory };
      if (options?.method === "POST") { posts.push(JSON.parse(options.body)); return { ok: true, json: async () => ({}) }; }
      return { ok: true, json: async () => ({ tenants: [tenant], leases: [], leaseMemberships: [], units: [], openCharges: [] }) };
    });
    vi.stubGlobal("fetch", fetch);
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => root.render(<RentalTenantPanel initialTenants={[tenant]} />));

    act(() => [...container.querySelectorAll("button")].find((button) => button.textContent === "Send invite email").click());
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
    act(() => [...container.querySelector('[role="alertdialog"]').querySelectorAll("button")].find((button) => button.textContent === "Cancel").click());

    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(posts).toHaveLength(0);
  });
});
