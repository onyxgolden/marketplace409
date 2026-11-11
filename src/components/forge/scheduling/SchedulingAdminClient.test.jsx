// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import SchedulingAdminClient from "./SchedulingAdminClient.jsx";

// The real migration (forge_scheduling_roles_provision_starter_set) hardcodes
// is_builtin=true for every one of the 4 starter roles -- these fixtures
// previously had it backwards (false), which is exactly why the
// is_builtin-based exclusion bug (every starter role filtered out of the
// assign dropdown and the capability matrix's editable check) was never
// caught: the fixture's is_builtin never matched what real data looks like.
const ROLE_ADMIN = { id: "forge_sr_1", role_key: "admin", name: "Admin", is_builtin: true, version: 1 };
const ROLE_VIEWER = { id: "forge_sr_2", role_key: "viewer", name: "Viewer", is_builtin: true, version: 1 };
// A literal "owner" row never exists in practice (owner authority is
// structural -- see PR #767/#773); this fixture exists only to prove the UI
// defensively excludes one by role_key if it ever did.
const ROLE_OWNER = { id: "forge_sr_owner", role_key: "owner", name: "Owner", is_builtin: true, version: 1 };
// The other two starter roles, used only by the realistic-provision test
// below (all four starters present at once, matching a real provisioned
// workspace).
const ROLE_SCHEDULER = { id: "forge_sr_3", role_key: "scheduler", name: "Scheduler", is_builtin: true, version: 1 };
const ROLE_CREW_LEAD = { id: "forge_sr_4", role_key: "crew_lead", name: "Crew Lead", is_builtin: true, version: 1 };

function snapshotWith({ roles = [ROLE_OWNER, ROLE_ADMIN, ROLE_VIEWER], capabilities = [], assignments = [] } = {}) {
  return { roles, capabilities, assignments, generations: { roles: { count: roles.length, max_version: 1 }, assignments: { count: assignments.length, max_version: 1 } } };
}

function stubFetch({ snapshot = snapshotWith(), audit = [], handlers = {} } = {}) {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    const method = options.method || "GET";
    calls.push({ url, method, body: options.body ? JSON.parse(options.body) : undefined });
    if (url === "/api/forge/scheduling/admin/roles" && method === "GET") {
      return { ok: true, status: 200, json: async () => ({ snapshot }) };
    }
    if (url.startsWith("/api/forge/scheduling/admin/audit")) {
      return { ok: true, status: 200, json: async () => ({ entries: audit }) };
    }
    if (url.startsWith("/api/forge/scheduling/admin/staff/search")) {
      const result = handlers.search ? handlers.search(url) : { ok: true, status: 200, json: async () => ({ results: [] }) };
      return result;
    }
    if (handlers[`${method} ${url.split("?")[0]}`]) {
      return handlers[`${method} ${url.split("?")[0]}`](options);
    }
    const match = Object.keys(handlers).find((key) => {
      const [m, pattern] = key.split(" ");
      if (m !== method) return false;
      const regex = new RegExp("^" + pattern.replace(/\[.*?\]/g, "[^/]+") + "$");
      return regex.test(url.split("?")[0]);
    });
    if (match) return handlers[match](options, url);
    throw new Error(`unexpected fetch ${method} ${url}`);
  }));
  return { calls };
}

function renderClient() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<SchedulingAdminClient />);
  });
  return { container, root };
}

async function settle() {
  await act(async () => {});
}

function setInputValue(elem, value) {
  const proto = elem.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  setter.call(elem, value);
  elem.dispatchEvent(new Event("input", { bubbles: true }));
  elem.dispatchEvent(new Event("change", { bubbles: true }));
}

function clickByText(container, text, tag = "button") {
  const el = [...container.querySelectorAll(tag)].find((n) => n.textContent.trim() === text);
  if (!el) throw new Error(`no ${tag} with text "${text}"`);
  act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("SchedulingAdminClient", () => {
  it("renders the role columns and the capability matrix once the snapshot loads", async () => {
    stubFetch();
    const { container } = renderClient();
    await settle();
    const text = container.textContent;
    expect(text).toContain("Admin");
    expect(text).toContain("Viewer");
    expect(text).toContain("Owner");
    expect(text).toContain("View schedules");
    expect(text).toContain("View audit timeline");
    expect(text).not.toContain("Audit timeline");
  });

  it("offers to provision starter roles when none exist yet, and never shows the matrix in that state", async () => {
    stubFetch({ snapshot: snapshotWith({ roles: [] }) });
    const { container } = renderClient();
    await settle();
    expect(container.textContent).toContain("No roles exist yet for this workspace.");
    expect(container.querySelector("table")).toBeNull();
  });

  it("never renders a scheduling.tv.* capability anywhere in the matrix", async () => {
    stubFetch();
    const { container } = renderClient();
    await settle();
    expect(container.textContent).not.toMatch(/view tv|manage tv layout|publish to tv/i);
    for (const cb of container.querySelectorAll('input[type="checkbox"]')) {
      expect(cb.getAttribute("aria-label") || "").not.toMatch(/\btv\b/i);
    }
  });

  it("disables every checkbox in the built-in Owner column — it can never be edited", async () => {
    stubFetch();
    const { container } = renderClient();
    await settle();
    const ownerBoxes = [...container.querySelectorAll('input[aria-label$="— Owner"]')];
    expect(ownerBoxes.length).toBeGreaterThan(0);
    for (const box of ownerBoxes) expect(box.disabled).toBe(true);
  });

  it("with a realistic fully-provisioned workspace, every starter role's checkboxes are enabled and its assignment renders (the test that would have caught the is_builtin bug)", async () => {
    const assignment = { id: "forge_asg_admin_1", assignee_user_id: "user_99", role_id: "forge_sr_1", version: 1, assigned_at: "2026-11-10T00:00:00Z" };
    const snapshot = snapshotWith({
      roles: [ROLE_OWNER, ROLE_ADMIN, ROLE_SCHEDULER, ROLE_CREW_LEAD, ROLE_VIEWER],
      capabilities: [{ role_id: "forge_sr_1", capability_key: "scheduling.schedules.read" }],
      assignments: [assignment],
    });
    stubFetch({ snapshot });
    const { container } = renderClient();
    await settle();

    // Every real starter role's checkboxes are enabled (is_builtin: true must
    // not disable them) -- only the synthetic Owner column stays disabled.
    for (const roleName of ["Admin", "Scheduler", "Crew Lead", "Viewer"]) {
      const boxes = [...container.querySelectorAll(`input[aria-label$="— ${roleName}"]`)];
      expect(boxes.length).toBeGreaterThan(0);
      for (const box of boxes) expect(box.disabled).toBe(false);
    }
    for (const box of container.querySelectorAll('input[aria-label$="— Owner"]')) {
      expect(box.disabled).toBe(true);
    }

    // The existing assignment to the starter role Admin actually renders.
    expect(container.textContent).toContain("user_99");
    expect(container.textContent).toContain("Admin");
  });

  it("with a realistic fully-provisioned workspace, the assign dropdown lists every starter role and never the synthetic Owner row", async () => {
    const snapshot = snapshotWith({ roles: [ROLE_OWNER, ROLE_ADMIN, ROLE_SCHEDULER, ROLE_CREW_LEAD, ROLE_VIEWER] });
    const handlers = { search: () => ({ ok: true, status: 200, json: async () => ({ results: [{ user_id: "user_1", email: "staff@example.com" }] }) }) };
    stubFetch({ snapshot, handlers });
    const { container } = renderClient();
    await settle();

    setInputValue(container.querySelector("#scheduling-admin-search-id"), "user_1");
    clickByText(container, "Search");
    await settle();
    clickByText(container, "Assign a role…");
    await settle();

    const options = [...container.querySelector('select[aria-label="Role to assign"]').querySelectorAll("option")].map((o) => o.textContent);
    expect(options).toEqual(expect.arrayContaining(["Admin", "Scheduler", "Crew Lead", "Viewer"]));
    expect(options).not.toContain("Owner");
  });

  it("toggling a capability opens a plain-English confirmation naming the role, and only sends the PATCH after confirming", async () => {
    const handlers = {
      "PATCH /api/forge/scheduling/admin/roles/forge_sr_2/capabilities": async (options) => {
        const body = JSON.parse(options.body);
        expect(body).toEqual({ capabilityKey: "scheduling.calendars.read", grant: true, expectedVersion: 1 });
        return { ok: true, status: 200, json: async () => ({ role: { ...ROLE_VIEWER, version: 2 } }) };
      },
    };
    const { calls } = stubFetch({ handlers });
    const { container } = renderClient();
    await settle();

    const box = [...container.querySelectorAll('input[type="checkbox"]')].find(
      (c) => c.getAttribute("aria-label") === "View calendars — Viewer",
    );
    expect(box).toBeTruthy();
    act(() => { box.dispatchEvent(new MouseEvent("click", { bubbles: true })); box.checked = true; box.dispatchEvent(new Event("change", { bubbles: true })); });
    await settle();

    expect(container.textContent).toContain("Grant a permission");
    expect(container.textContent).toContain("Viewer");
    expect(calls.some((c) => c.method === "PATCH")).toBe(false); // not sent yet

    clickByText(container, "Confirm");
    await settle();

    expect(calls.some((c) => c.method === "PATCH" && c.url.includes("forge_sr_2"))).toBe(true);
  });

  it("cancelling the confirmation dialog sends no request", async () => {
    stubFetch();
    const { container } = renderClient();
    await settle();
    const box = container.querySelector('input[type="checkbox"]');
    act(() => { box.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await settle();
    expect(container.textContent).toMatch(/Grant a permission|Remove a permission/);
    clickByText(container, "Cancel");
    await settle();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("searches staff by exact user id, then assigns a role with a confirmation naming the person and role", async () => {
    const handlers = {
      "POST /api/forge/scheduling/admin/assignments": async (options) => {
        const body = JSON.parse(options.body);
        expect(body).toEqual({ assigneeUserId: "user_42", roleId: "forge_sr_1" });
        return { ok: true, status: 201, json: async () => ({ assignment: { id: "forge_asg_1", assignee_user_id: "user_42", role_id: "forge_sr_1", version: 1 } }) };
      },
      search: () => ({ ok: true, status: 200, json: async () => ({ results: [{ user_id: "user_42", email: "staff@example.com" }] }) }),
    };
    const { calls } = stubFetch({ handlers });
    const { container } = renderClient();
    await settle();

    const idInput = container.querySelector("#scheduling-admin-search-id");
    setInputValue(idInput, "user_42");
    clickByText(container, "Search");
    await settle();

    expect(container.textContent).toContain("staff@example.com");
    clickByText(container, "Assign a role…");
    await settle();

    const select = container.querySelector('select[aria-label="Role to assign"]');
    setInputValue(select, "forge_sr_1");
    clickByText(container, "Assign");
    await settle();

    expect(container.textContent).toContain("staff@example.com");
    expect(container.textContent).toContain("Admin");
    expect(calls.some((c) => c.method === "POST" && c.url === "/api/forge/scheduling/admin/assignments")).toBe(false);

    clickByText(container, "Confirm");
    await settle();

    expect(calls.some((c) => c.method === "POST" && c.url === "/api/forge/scheduling/admin/assignments")).toBe(true);
  });

  it("shows currently assigned staff and revokes with a confirmation, requiring the stored version", async () => {
    const assignment = { id: "forge_asg_9", assignee_user_id: "user_7", role_id: "forge_sr_1", version: 3, assigned_at: "2026-11-10T00:00:00Z" };
    const handlers = {
      "DELETE /api/forge/scheduling/admin/assignments/forge_asg_9": async (options) => {
        const body = JSON.parse(options.body);
        expect(body).toEqual({ expectedVersion: 3 });
        return { ok: true, status: 200, json: async () => ({ assignment: { ...assignment, retired_at: "now" } }) };
      },
    };
    const { calls } = stubFetch({ snapshot: snapshotWith({ assignments: [assignment] }), handlers });
    const { container } = renderClient();
    await settle();

    expect(container.textContent).toContain("user_7");
    clickByText(container, "Revoke");
    await settle();
    expect(container.textContent).toContain("Revoke this role assignment");
    clickByText(container, "Confirm");
    await settle();

    expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/forge/scheduling/admin/assignments/forge_asg_9")).toBe(true);
  });

  it("on a 409 stale-version response, shows a reload warning and refetches the snapshot instead of silently retrying", async () => {
    let roleCallCount = 0;
    const handlers = {
      "PATCH /api/forge/scheduling/admin/roles/forge_sr_2/capabilities": async () => ({
        ok: false, status: 409, json: async () => ({ error: "This role or assignment was changed by someone else. Reload and try again." }),
      }),
    };
    vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
      const method = options.method || "GET";
      if (url === "/api/forge/scheduling/admin/roles" && method === "GET") {
        roleCallCount += 1;
        return { ok: true, status: 200, json: async () => ({ snapshot: snapshotWith() }) };
      }
      if (url.startsWith("/api/forge/scheduling/admin/audit")) return { ok: true, status: 200, json: async () => ({ entries: [] }) };
      if (method === "PATCH") return handlers["PATCH /api/forge/scheduling/admin/roles/forge_sr_2/capabilities"]();
      throw new Error(`unexpected fetch ${method} ${url}`);
    }));
    const { container } = renderClient();
    await settle();
    expect(roleCallCount).toBe(1);

    const box = [...container.querySelectorAll('input[type="checkbox"]')].find(
      (c) => c.getAttribute("aria-label") === "View calendars — Viewer",
    );
    act(() => { box.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await settle();
    clickByText(container, "Confirm");
    await settle();

    expect(container.textContent).toContain("changed by someone else");
    expect(roleCallCount).toBe(2); // refetched after the 409
  });

  it("does not fetch the audit log until the audit timeline is opened", async () => {
    const audit = [{ id: "forge_sa_1", actor_id: "user_1", action: "capability_add", target_role_id: "forge_sr_2", target_user_id: null, reason: "widen calendar access", recorded_at: "2026-11-10T01:00:00Z" }];
    const { calls } = stubFetch({ audit });
    const { container } = renderClient();
    await settle();

    expect(calls.some((c) => c.url.startsWith("/api/forge/scheduling/admin/audit"))).toBe(false);
    expect(container.querySelector('[aria-labelledby="scheduling-admin-audit-heading"]')).toBeNull();

    clickByText(container, "View audit timeline");
    await settle();

    expect(calls.some((c) => c.url.startsWith("/api/forge/scheduling/admin/audit"))).toBe(true);
    expect(container.textContent).toContain("capability add");
    expect(container.textContent).toContain("user_1");
    expect(container.textContent).toContain("widen calendar access");
  });

  it("closes the audit timeline and returns to the admin page with the roles matrix intact", async () => {
    stubFetch();
    const { container } = renderClient();
    await settle();

    clickByText(container, "View audit timeline");
    await settle();
    expect(container.querySelector('[aria-labelledby="scheduling-admin-audit-heading"]')).not.toBeNull();

    clickByText(container, "Back to admin");
    await settle();
    expect(container.querySelector('[aria-labelledby="scheduling-admin-audit-heading"]')).toBeNull();
    expect(container.textContent).toContain("Admin");
    expect(container.querySelector("table")).not.toBeNull();
  });

  it("shows the not-applied message distinctly when the migration has not run yet", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (url === "/api/forge/scheduling/admin/roles") {
        return { ok: false, status: 503, json: async () => ({ error: "Scheduling role administration is not available yet." }) };
      }
      return { ok: true, status: 200, json: async () => ({ entries: [] }) };
    }));
    const { container } = renderClient();
    await settle();
    expect(container.textContent).toContain("Scheduling role administration is not available yet.");
    expect(container.textContent).toContain("migration has not been applied");
  });
});
