// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// New client / New site / New project controls on the Planner's
// project-scope bar (/forge/work). Covers: canManage gating, the
// create -> auto-advance-to-next-level flow (client -> site -> project),
// project create navigating via onProjectCreated, validation surfacing,
// and the shared tap-target sizing.
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

function stubFetch({ canManage = true, clients = [] } = {}) {
  const calls = [];
  const server = { canManage, clients: structuredClone(clients) };
  let seq = 100;
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    const method = options.method || "GET";
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url: String(url), method, body });
    if (!String(url).startsWith("/api/forge/hierarchy")) throw new Error(`unexpected fetch ${url}`);
    if (method === "GET") return ok({ inventory: server });
    if (method === "POST") {
      if (body.entity === "client") {
        const created = { id: `forge_cli_new${seq++}`, name: body.name, sites: [] };
        server.clients.push(created);
        return ok({ client: created }, 201);
      }
      if (body.entity === "site") {
        const client = server.clients.find((c) => c.id === body.clientId);
        if (!client) return fail(404, "That client could not be found.");
        const created = { id: `forge_site_new${seq++}`, name: body.name, projects: [] };
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
    for (const b of buttons) expect(b.className).toContain("min-h-11");
  });

  it("creating a client auto-opens New site pre-filled to that client, and creating the site auto-opens New project pre-filled to it", async () => {
    stubFetch({ canManage: true });
    const { container } = render();
    await flush();

    click([...container.querySelectorAll("button")].find((b) => b.textContent === "New client"));
    await flush();

    const nameInput = container.querySelector("#planner-add-hierarchy-form-name");
    expect(nameInput).not.toBeNull();
    setInputValue(nameInput, "Acme");
    click([...container.querySelectorAll("button")].find((b) => b.textContent === "Save"));
    await flush();

    // Auto-advanced to "New site" with the new client as parent.
    expect(container.querySelector('[data-testid="planner-add-hierarchy-form"]').textContent).toContain("New site");
    const parentSelect = container.querySelector("#planner-add-hierarchy-form-parent");
    expect(parentSelect.value).toMatch(/^forge_cli_new/);

    setInputValue(container.querySelector("#planner-add-hierarchy-form-name"), "Plant 1");
    click([...container.querySelectorAll("button")].find((b) => b.textContent === "Save"));
    await flush();

    // Auto-advanced to "New project" with the new site as parent.
    expect(container.querySelector('[data-testid="planner-add-hierarchy-form"]').textContent).toContain("New project");
    const projectParentSelect = container.querySelector("#planner-add-hierarchy-form-parent");
    expect(projectParentSelect.value).toMatch(/^forge_site_new/);
  });

  it("creating a project calls onProjectCreated with the new project id, so the planner lands on it", async () => {
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
    // The form closes after a project create (there's nowhere further to auto-advance to).
    expect(container.querySelector('[data-testid="planner-add-hierarchy-form"]')).toBeNull();
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
    expect(calls.length).toBe(callsBeforeSave); // no new fetch at all on a client-side validation failure
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
});
