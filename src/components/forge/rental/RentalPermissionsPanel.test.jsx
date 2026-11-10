// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RENTAL_ADMIN_CAPABILITIES } from "@/lib/rental/adminPermissions";
import RentalPermissionsPanel from "./RentalPermissionsPanel.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const response = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

async function flush(times = 1) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }
}

function click(button) {
  return act(async () => {
    button.click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setValue(element, value) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  ).set;
  return act(async () => {
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
}

function setSelect(element, value) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLSelectElement.prototype,
    "value"
  ).set;
  return act(async () => {
    setter.call(element, value);
    element.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
}

function findButton(container, text) {
  const button = [...container.querySelectorAll("button")].find(
    (b) => b.textContent.trim() === text
  );
  if (!button) throw new Error(`Button not found: ${text}`);
  return button;
}

function baseRoles() {
  return [
    {
      id: "role-admin",
      name: "rental_admin",
      display_name: "Rental Admin",
      is_system: true,
      version: 1,
      retired_at: null,
      capabilities: ["rental.tenants.read", "rental.leases.read"],
      active_assignee_count: 1,
    },
    {
      id: "role-manager",
      name: "manager",
      display_name: "Manager",
      is_system: true,
      version: 1,
      retired_at: null,
      capabilities: ["rental.tenants.read"],
      active_assignee_count: 2,
    },
    {
      id: "role-custom",
      name: "leasing_agent",
      display_name: "Leasing Agent",
      is_system: false,
      version: 3,
      retired_at: null,
      capabilities: ["rental.tenants.read", "rental.leases.read"],
      active_assignee_count: 0,
    },
  ];
}

function baseAudit() {
  return [
    {
      id: "audit-1",
      action: "role.updated",
      actor_user_id: "actor-1",
      target_role_id: "role-manager",
      target_user_id: null,
      detail: {
        added: ["rental.reports.read"],
        removed: ["rental.tenants.edit"],
        affected_user_count: 2,
        role_name: "Manager",
        previous_version: 1,
        new_version: 2,
      },
      created_at: "2026-11-10T00:00:00.000Z",
    },
  ];
}

describe("RentalPermissionsPanel", () => {
  let root;
  afterEach(() => {
    if (root) act(() => root.unmount());
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  async function renderPanel({ onPatch } = {}) {
    const calls = [];
    const liveRoles = baseRoles();
    const liveAudit = baseAudit();
    const liveUsers = {
      "staff@example.test": {
        user_id: "user-staff",
        email: "staff@example.test",
        r17_role: "property_manager",
        r17_status: "active",
        current_role: { id: "role-manager", name: "manager", display_name: "Manager" },
        effective_keys: ["rental.tenants.read", "rental.leases.read"],
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, options) => {
        calls.push({ url, options });
        const method = options?.method || "GET";
        if (url === "/api/rental/admin/roles" && method === "GET") {
          return response({
            success: true,
            roles: liveRoles,
            catalog: RENTAL_ADMIN_CAPABILITIES,
            starterRoles: [],
            ownerOnlyKeys: ["rental.billing.activate"],
            myEffectiveKeys: ["rental.roles.manage"],
            viewerId: "viewer-1",
          });
        }
        if (url.startsWith("/api/rental/admin/audit")) {
          return response({ success: true, entries: liveAudit });
        }
        if (url === "/api/rental/admin/lookup" && method === "POST") {
          const body = JSON.parse(options.body);
          const user = liveUsers[body.search] || null;
          if (!user) return response({ error: "No account was found." }, 404);
          return response({ success: true, user });
        }
        if (url === "/api/rental/admin/assign" && method === "POST") {
          const body = JSON.parse(options.body);
          const role = liveRoles.find((r) => r.id === body.roleId);
          const user = Object.values(liveUsers).find((u) => u.user_id === body.userId);
          user.current_role = { id: role.id, name: role.name, display_name: role.display_name };
          user.effective_keys = [...role.capabilities];
          liveAudit.unshift({
            id: `audit-${Date.now()}`,
            action: "role.assigned",
            actor_user_id: "viewer-1",
            target_role_id: role.id,
            target_user_id: user.user_id,
            detail: { role_name: role.name, request_id: body.requestId },
            created_at: "2026-11-10T01:00:00.000Z",
          });
          return response({
            success: true,
            user,
            message: `Assigned the ${role.display_name} role to ${user.email}.`,
          });
        }
        if (url === "/api/rental/admin/roles" && method === "PATCH") {
          if (onPatch) {
            const handled = await onPatch({ calls, liveRoles, liveAudit, options });
            if (handled) return handled;
          }
          const body = JSON.parse(options.body);
          const role = liveRoles.find((r) => r.id === body.roleId);
          const next = new Set(role.capabilities);
          (body.addKeys || []).forEach((k) => next.add(k));
          (body.removeKeys || []).forEach((k) => next.delete(k));
          role.capabilities = [...next];
          role.version += 1;
          return response({
            success: true,
            role,
            affectedUserCount: role.active_assignee_count,
            added: body.addKeys || [],
            removed: body.removeKeys || [],
            version: role.version,
            message: `Saved the role: added View reports. This changes access for ${role.active_assignee_count} staff members.`,
          });
        }
        if (url === "/api/rental/admin/roles/retire" && method === "POST") {
          const body = JSON.parse(options.body);
          const role = liveRoles.find((r) => r.id === body.roleId);
          role.retired_at = "2026-11-10T01:00:00.000Z";
          return response({
            success: true,
            role,
            reassignedCount: 0,
            message: `Retired the ${role.display_name} role.`,
          });
        }
        return response({ error: `Unexpected call: ${method} ${url}` }, 500);
      })
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<RentalPermissionsPanel />));
    await flush(2);
    return { container, calls, liveRoles, liveUsers };
  }

  it("loads roles with assignee counts and the role change log", async () => {
    const { container } = await renderPanel();
    expect(container.textContent).toContain("Rental Admin");
    expect(container.textContent).toContain("Manager");
    expect(container.textContent).toContain("Leasing Agent");
    expect(container.textContent).toContain("2 staff members");
    expect(container.textContent).toContain("Version 1");
    expect(container.textContent).toContain(
      "Role updated: Manager: added View reports; removed Edit tenants. Affects 2 staff members."
    );
    expect(container.querySelector("[data-role-id='role-manager']")).not.toBeNull();
  });

  it("searches a user and shows their current role and effective permissions", async () => {
    const { container } = await renderPanel();
    const searchInput = container.querySelector(
      'input[placeholder="user id or name@example.com"]'
    );
    await setValue(searchInput, "staff@example.test");
    await click(findButton(container, "Search"));
    await flush(2);
    const card = container.querySelector("[data-found-user='user-staff']");
    expect(card).not.toBeNull();
    expect(card.textContent).toContain("staff@example.test");
    expect(card.textContent).toContain("Team role: property_manager (active)");
    expect(card.textContent).toContain("Manager");
    expect(card.textContent).toContain("View tenants");
    expect(card.textContent).toContain("View leases");
  });

  it("assigns a role and shows the server confirmation with the refreshed role", async () => {
    const { container, calls } = await renderPanel();
    const searchInput = container.querySelector(
      'input[placeholder="user id or name@example.com"]'
    );
    await setValue(searchInput, "staff@example.test");
    await click(findButton(container, "Search"));
    await flush(2);
    const card = container.querySelector("[data-found-user='user-staff']");
    const select = card.querySelector("select");
    await setSelect(select, "role-admin");
    await click(findButton(card, "Assign role"));
    await flush(3);
    const assignCall = calls.find(
      (c) => c.url === "/api/rental/admin/assign" && c.options?.method === "POST"
    );
    expect(assignCall).toBeDefined();
    expect(assignCall.options.credentials).toBe("same-origin");
    const assignBody = JSON.parse(assignCall.options.body);
    expect(assignBody.userId).toBe("user-staff");
    expect(assignBody.roleId).toBe("role-admin");
    expect(typeof assignBody.requestId).toBe("string");
    expect(container.textContent).toContain(
      "Assigned the Rental Admin role to staff@example.test."
    );
    const refreshed = container.querySelector("[data-found-user='user-staff']");
    expect(refreshed.textContent).toContain("Rental Admin");
  });

  it("edits a role grid, shows the diff preview and affected count, then confirms the save", async () => {
    const { container } = await renderPanel();
    await click(findButton(container, "Edit Manager"));
    const checkbox = container.querySelector(
      '[id="edit-role-manager-rental.reports.read"]'
    );
    expect(checkbox).not.toBeNull();
    expect(checkbox.disabled).toBe(false);
    await click(checkbox);
    expect(container.textContent).toContain("added View reports");
    expect(container.textContent).toContain("This changes access for 2 staff members.");
    await click(findButton(container, "Save role changes"));
    await flush(3);
    expect(container.textContent).toContain(
      "Saved the role: added View reports. This changes access for 2 staff members."
    );
  });

  it("retires a custom role with a confirm step and shows the server message", async () => {
    const { container, calls } = await renderPanel();
    // Starter roles get no retire button; only the custom role does.
    expect(
      container.querySelector("[data-role-id='role-manager']").textContent
    ).not.toContain("Retire Manager");
    await click(findButton(container, "Retire Leasing Agent"));
    await click(findButton(container, "Retire this role?"));
    await flush(3);
    const retireCall = calls.find(
      (c) => c.url === "/api/rental/admin/roles/retire" && c.options?.method === "POST"
    );
    expect(retireCall).toBeDefined();
    expect(JSON.parse(retireCall.options.body).roleId).toBe("role-custom");
    expect(container.textContent).toContain("Retired the Leasing Agent role.");
    expect(
      container.querySelector("[data-role-id='role-custom']").textContent
    ).toContain("Retired");
  });

  it("shows the fresh diff on a 409 stale version and lets the user retry from the fresh state", async () => {
    let patchCount = 0;
    const { container } = await renderPanel({
      onPatch: async ({ liveRoles, options }) => {
        patchCount += 1;
        if (patchCount === 1) {
          const fresh = liveRoles.map((r) =>
            r.id === "role-manager"
              ? {
                  ...r,
                  version: 2,
                  capabilities: ["rental.tenants.read", "rental.reports.read"],
                }
              : r
          );
          fresh.forEach((r) => {
            const live = liveRoles.find((x) => x.id === r.id);
            live.capabilities = [...r.capabilities];
            live.version = r.version;
          });
          return response(
            {
              error: "This role was changed by someone else.",
              code: "stale_version",
              roles: fresh,
            },
            409
          );
        }
        const body = JSON.parse(options.body);
        expect(body.expectedVersion).toBe(2);
        const role = liveRoles.find((r) => r.id === body.roleId);
        const next = new Set(role.capabilities);
        (body.addKeys || []).forEach((k) => next.add(k));
        (body.removeKeys || []).forEach((k) => next.delete(k));
        role.capabilities = [...next];
        role.version += 1;
        return response({
          success: true,
          role,
          affectedUserCount: role.active_assignee_count,
          added: body.addKeys || [],
          removed: body.removeKeys || [],
          version: role.version,
          message: "Saved the role: removed View tenants. This changes access for 2 staff members.",
        });
      },
    });
    await click(findButton(container, "Edit Manager"));
    const reportsCheckbox = container.querySelector(
      '[id="edit-role-manager-rental.reports.read"]'
    );
    await click(reportsCheckbox);
    await click(findButton(container, "Save role changes"));
    await flush(2);
    expect(container.textContent).toContain(
      "This role was changed by someone else — here is the current version"
    );
    expect(container.textContent).toContain("added View reports");
    const freshReports = container.querySelector(
      '[id="edit-role-manager-rental.reports.read"]'
    );
    expect(freshReports.checked).toBe(true);
    const tenantsCheckbox = container.querySelector(
      '[id="edit-role-manager-rental.tenants.read"]'
    );
    await click(tenantsCheckbox);
    expect(container.textContent).toContain("removed View tenants");
    await click(findButton(container, "Save role changes"));
    await flush(3);
    expect(container.textContent).toContain(
      "Saved the role: removed View tenants. This changes access for 2 staff members."
    );
  });
});
