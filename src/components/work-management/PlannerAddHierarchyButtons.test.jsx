// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// New client / New site / New project controls on the Planner's
// project-scope bar (/forge/work). PR #848 review (2026-11-21, NEEDS
// CHANGES) findings covered here: canManage gating; the create flow is
// the SAME useHierarchyRecordForm hook Admin uses (P1 -- not a second,
// independently-coded create flow); the "<name> created." confirmation
// stays visible through the client -> site -> project auto-advance
// instead of being erased by the next form opening (P1); an inventory
// load failure shows a reason + retry, distinct from a proven
// canManage=false (P2); project create still navigates via
// onProjectCreated; client/site create reports onCreated so the scope
// bar can preselect the new record (tested in PlannerProjectScopeBar
// coverage / HierarchyProjectSelector's own pendingSelection tests).
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import PlannerAddHierarchyButtons from "./PlannerAddHierarchyButtons.jsx";

function ok(body) {
  return { ok: true, status: 200, json: async () => body };
}

function fail(status, error) {
  return { ok: false, status, json: async () => ({ error }) };
}

function stubFetch({ canManage = true, clients = [], failInventory = false } = {}) {
  const calls = [];
  const server = { canManage, clients: structuredClone(clients) };
  let seq = 100;
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    const method = options.method || "GET";
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url: String(url), method, body });
    if (!String(url).startsWith("/api/forge/hierarchy")) throw new Error(`unexpected fetch ${url}`);
    if (method === "GET") {
      if (failInventory) return fail(500, "Database unavailable.");
      return ok({ inventory: server });
    }
    if (method === "POST") {
      if (body.entity === "client") {
        const created = { id: `forge_cli_new${seq++}`, name: body.name, sites: [] };
        server.clients.push(created);
        return ok({ client: created }, 201);
      }
      if (body.entity === "site") {
        const client = server.clients.find((c) => c.id === body.clientId);
        if (!client) return fail(404, "That client could not be found.");
        const created = { id: `forge_site_new${seq++}`, name: body.name, clientId: body.clientId, projects: [] };
        client.sites = client.sites || [];
        client.sites.push(created);
        return ok({ site: created }, 201);
      }
      if (body.entity === "project") {
        const created = { id: `forge_prj_new${seq++}`, name: body.name };
        return ok({ project: created }, 201);
      }
    }
    throw new Error(`unexpected ${method} ${url}`);
  }));
  return calls;
}

async function flush(times = 6) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function setInputValue(elem, value) {
  const proto =
    elem.tagName === "SELECT"
      ? window.HTMLSelectElement.prototype
      : elem.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  setter.call(elem, value);
  elem.dispatchEvent(new Event("input", { bubbles: true }));
  elem.dispatchEvent(new Event("change", { bubbles: true }));
}

function click(el) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function render(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<PlannerAddHierarchyButtons {...props} />);
  });
  return { container, root };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("PlannerAddHierarchyButtons", () => {
  it("renders nothing when the actor cannot manage the hierarchy", async () => {
    stubFetch({ canManage: false });
    const { container } = render();
    await flush();
    expect(container.querySelector('[data-testid="planner-add-hierarchy-buttons"]')).toBeNull();
    expect(container.querySelector('[data-testid="planner-add-hierarchy-error"]')).toBeNull();
  });

  it("shows a reason and a retry control when the inventory load fails, distinct from a proven lack of permission", async () => {
    stubFetch({ failInventory: true });
    const { container } = render();
    await flush();
    const errorBox = container.querySelector('[data-testid="planner-add-hierarchy-error"]');
    expect(errorBox).not.toBeNull();
    expect(errorBox.textContent).toContain("Database unavailable.");
    const retryBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Try again");
    expect(retryBtn).not.toBeNull();
  });

  it("renders all three buttons, each meeting the ~44px tap target, when canManage is true", async () => {
    stubFetch({ canManage: true });
    const { container } = render();
    await flush();
    const buttons = [...container.querySelectorAll("button")];
    const labels = buttons.map((b) => b.textContent);
    expect(labels).toContain("New client");
    expect(labels).toContain("New site");
    expect(labels).toContain("New project");
    expect(labels).not.toContain("New test client");
    for (const b of buttons) expect(b.className).toContain("min-h-11");
  });

  it("creating a client shows its confirmation, which stays visible through the auto-advance into New site, and the site create stays visible into New project", async () => {
    stubFetch({ canManage: true });
    const { container } = render();
    await flush();

    click([...container.querySelectorAll("button")].find((b) => b.textContent === "New client"));
    await flush();
    setInputValue(container.querySelector("#planner-add-hierarchy-form-name"), "Acme");
    click([...container.querySelectorAll("button")].find((b) => b.textContent === "Save"));
    await flush();

    // Auto-advanced to "New site" with the new client as parent, AND the
    // "Acme created." confirmation is still on screen (PR #848 review P1 --
    // this used to be erased by the form opening underneath it).
    expect(container.querySelector('[data-testid="planner-add-hierarchy-form"]').textContent).toContain("New site");
    expect(container.textContent).toContain("Acme created.");
    const parentSelect = container.querySelector("#planner-add-hierarchy-form-parent");
    expect(parentSelect.value).toMatch(/^forge_cli_new/);

    setInputValue(container.querySelector("#planner-add-hierarchy-form-name"), "Plant 1");
    click([...container.querySelectorAll("button")].find((b) => b.textContent === "Save"));
    await flush();

    expect(container.querySelector('[data-testid="planner-add-hierarchy-form"]').textContent).toContain("New project");
    expect(container.textContent).toContain("Plant 1 created.");
    const projectParentSelect = container.querySelector("#planner-add-hierarchy-form-parent");
    expect(projectParentSelect.value).toMatch(/^forge_site_new/);
  });

  it("reports client and site creates via onCreated, with the site's clientId so the scope bar can preselect the right chain", async () => {
    stubFetch({ canManage: true, clients: [{ id: "forge_cli_1", name: "Acme", sites: [] }] });
    const onCreated = vi.fn();
    const { container } = render({ onCreated });
    await flush();

    click([...container.querySelectorAll("button")].find((b) => b.textContent === "New site"));
    await flush();
    setInputValue(container.querySelector("#planner-add-hierarchy-form-parent"), "forge_cli_1");
    setInputValue(container.querySelector("#planner-add-hierarchy-form-name"), "Plant 1");
    click([...container.querySelectorAll("button")].find((b) => b.textContent === "Save"));
    await flush();

    expect(onCreated).toHaveBeenCalledTimes(1);
    const [entity, saved] = onCreated.mock.calls[0];
    expect(entity).toBe("site");
    expect(saved.clientId).toBe("forge_cli_1");
  });

  it("creating a project calls onProjectCreated with the new project id and closes the form, so the planner lands on it", async () => {
    stubFetch({ canManage: true, clients: [{ id: "forge_cli_1", name: "Acme", sites: [{ id: "forge_site_1", name: "Plant 1", projects: [] }] }] });
    const onProjectCreated = vi.fn();
    const { container } = render({ onProjectCreated });
    await flush();

    click([...container.querySelectorAll("button")].find((b) => b.textContent === "New project"));
    await flush();
    setInputValue(container.querySelector("#planner-add-hierarchy-form-parent"), "forge_site_1");
    setInputValue(container.querySelector("#planner-add-hierarchy-form-name"), "Turnaround");
    click([...container.querySelectorAll("button")].find((b) => b.textContent === "Save"));
    await flush();

    expect(onProjectCreated).toHaveBeenCalledTimes(1);
    expect(onProjectCreated.mock.calls[0][0]).toMatch(/^forge_prj_new/);
    expect(container.querySelector('[data-testid="planner-add-hierarchy-form"]')).toBeNull();
    expect(container.textContent).toContain("Turnaround created.");
  });

  it("surfaces a validation error and never calls the API when the name is blank", async () => {
    const calls = stubFetch({ canManage: true });
    const { container } = render();
    await flush();

    click([...container.querySelectorAll("button")].find((b) => b.textContent === "New client"));
    await flush();

    const callsBeforeSave = calls.length;
    click([...container.querySelectorAll("button")].find((b) => b.textContent === "Save"));
    await flush();

    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
    expect(calls.length).toBe(callsBeforeSave);
  });

  it("New site and New project parent dropdowns offer only real (non-test) clients and sites", async () => {
    stubFetch({
      canManage: true,
      clients: [
        { id: "forge_cli_1", name: "Acme", sites: [{ id: "forge_site_1", name: "Plant 1", projects: [] }] },
        { id: "forge_cli_test1", name: "Fictional Test Client", isTest: true, sites: [{ id: "forge_site_test1", name: "Fictional Test Site", isTest: true, projects: [] }] },
      ],
    });
    const { container } = render();
    await flush();

    click([...container.querySelectorAll("button")].find((b) => b.textContent === "New site"));
    await flush();

    const parentOptions = [...container.querySelectorAll("#planner-add-hierarchy-form-parent option")].map((o) => o.textContent);
    expect(parentOptions).toContain("Acme");
    expect(parentOptions.join(" ")).not.toContain("Fictional Test Client");
  });

  it("Cancel closes the form and clears the notice", async () => {
    stubFetch({ canManage: true });
    const { container } = render();
    await flush();

    click([...container.querySelectorAll("button")].find((b) => b.textContent === "New client"));
    await flush();
    setInputValue(container.querySelector("#planner-add-hierarchy-form-name"), "Acme");
    click([...container.querySelectorAll("button")].find((b) => b.textContent === "Save"));
    await flush();
    expect(container.textContent).toContain("Acme created.");

    click([...container.querySelectorAll("button")].find((b) => b.textContent === "Cancel"));
    await flush();
    expect(container.querySelector('[data-testid="planner-add-hierarchy-form"]')).toBeNull();
    expect(container.textContent).not.toContain("Acme created.");
  });
});
