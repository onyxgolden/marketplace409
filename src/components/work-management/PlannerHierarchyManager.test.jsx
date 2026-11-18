// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// Planner hierarchy manager — Clients / Sites / Projects (brief:
// planner-hierarchy-management-page-build-brief-2026-11-15).
// Tree render, read-only mode, create/edit with inline confirmations,
// no-op saves, stale-version (409) reconciliation, archive/restore,
// delete blocking + confirm, search and status filter, navigation.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a>,
}));

import PlannerHierarchyManager from "./PlannerHierarchyManager.jsx";

const BASE_TREE = {
  ownerId: "owner_1",
  canManage: true,
  clients: [
    {
      id: "forge_cli_1", name: "Acme", externalReference: "ACME-1", notes: "",
      status: "active", version: 3,
      sites: [
        {
          id: "forge_site_1", name: "Plant 1", siteType: "industrial",
          addressLine1: "", addressLine2: "", city: "", region: "",
          postalCode: "", countryCode: "", status: "active", version: 2,
          projects: [
            { id: "forge_prj_1", name: "Turnaround", projectCode: "TA-01", description: "", projectType: "", plannedStart: null, plannedFinish: null, status: "active", version: 5, packageCount: 2 },
            { id: "forge_prj_2", name: "Revamp", projectCode: null, description: "", projectType: "", plannedStart: null, plannedFinish: null, status: "archived", version: 1, packageCount: 0 },
          ],
        },
        {
          id: "forge_site_2", name: "Plant 2", siteType: "industrial",
          addressLine1: "", addressLine2: "", city: "", region: "",
          postalCode: "", countryCode: "", status: "active", version: 1,
          projects: [],
        },
      ],
    },
    {
      id: "forge_cli_2", name: "Beta", externalReference: "", notes: "",
      status: "archived", version: 1, sites: [],
    },
  ],
};

const TEST_TREE = {
  ownerId: "owner_1",
  canManage: true,
  canUseOwnerTestData: true,
  clients: [
    {
      id: "forge_cli_test1", name: "Fictional Test Client", externalReference: "", notes: "",
      status: "active", version: 1, isTest: true,
      sites: [
        {
          id: "forge_site_test1", name: "Fictional Test Site", siteType: "industrial",
          addressLine1: "", addressLine2: "", city: "", region: "",
          postalCode: "", countryCode: "", status: "active", version: 1, isTest: true,
          projects: [
            { id: "forge_prj_test1", name: "Fictional Test Project", projectCode: null, description: "", projectType: "", plannedStart: null, plannedFinish: null, status: "active", version: 1, packageCount: 0, isTest: true },
          ],
        },
      ],
    },
  ],
};

function ok(body, status = 200) {
  return { ok: true, status, json: async () => body };
}

function fail(status, error) {
  return { ok: false, status, json: async () => ({ error }) };
}

function findIn(server, entity, id) {
  for (const client of server.clients) {
    if (entity === "client" && client.id === id) return client;
    for (const site of client.sites ?? []) {
      if (entity === "site" && site.id === id) return site;
      for (const project of site.projects ?? []) {
        if (entity === "project" && project.id === id) return project;
      }
    }
  }
  return null;
}

function stubFetch({ canManage = true, tree = BASE_TREE, testTree = TEST_TREE, canUseOwnerTestData = false } = {}) {
  const calls = [];
  let server = structuredClone(tree);
  server.canManage = canManage;
  server.canUseOwnerTestData = canUseOwnerTestData;
  let testServer = structuredClone(testTree);
  testServer.canManage = canManage;
  testServer.canUseOwnerTestData = canUseOwnerTestData;
  const counters = { client: 100, site: 100, project: 100 };
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    const method = options.method || "GET";
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url, method, body });
    if (String(url).startsWith("/api/forge/planner/test-data/load")) {
      if (method !== "POST") throw new Error(`unexpected method ${method} on ${url}`);
      return ok({ load: { loaded: true, alreadyLoaded: false, packages: 6, steps: 31, message: "Loaded 6 sample packages / 31 steps" } });
    }
    if (String(url).startsWith("/api/forge/planner/test-data/preview")) {
      if (method !== "POST") throw new Error(`unexpected method ${method} on ${url}`);
      return ok({ preview: {
        clientId: body.clientId, clientName: "Fictional Test Client",
        counts: { forge_clients: 1, forge_sites: 1, forge_projects: 1, forge_work_packages: 6, forge_work_steps: 31 },
        blockers: [], canPurge: true, digest: "a".repeat(64),
      } });
    }
    if (String(url).startsWith("/api/forge/planner/test-data/purge")) {
      if (method !== "POST") throw new Error(`unexpected method ${method} on ${url}`);
      testServer.clients = testServer.clients.filter((c) => c.id !== body.clientId);
      return ok({ purge: { purged: true, alreadyPurged: false, message: "Test data deleted — \"Fictional Test Client\" and its samples are gone." } });
    }
    if (!String(url).startsWith("/api/forge/hierarchy")) {
      throw new Error(`unexpected fetch ${url}`);
    }
    if (method === "GET") {
      if (String(url).includes("mode=test")) return ok({ inventory: testServer });
      return ok({ inventory: server });
    }
    if (method === "POST") {
      if (body.entity === "client") {
        if (body.isTest === true) {
          if (testServer.clients.some((c) => c.name.toLowerCase() === String(body.name).trim().toLowerCase())) {
            return fail(409, "A client with that name already exists.");
          }
          const created = {
            id: `forge_cli_test${counters.client++}`, name: body.name, externalReference: body.externalReference,
            notes: body.notes, status: "active", version: 1, sites: [], isTest: true,
          };
          testServer.clients.push(created);
          return ok({ client: created }, 201);
        }
        if (server.clients.some((c) => c.name.toLowerCase() === String(body.name).trim().toLowerCase())) {
          return fail(409, "A client with that name already exists.");
        }
        const created = {
          id: `forge_cli_new${counters.client++}`, name: body.name, externalReference: body.externalReference,
          notes: body.notes, status: "active", version: 1, sites: [],
        };
        server.clients.push(created);
        return ok({ client: created }, 201);
      }
      if (body.entity === "site") {
        const parent = findIn(server, "client", body.clientId);
        if (!parent) return fail(404, "That client could not be found.");
        const created = {
          id: `forge_site_new${counters.site++}`, name: body.name, siteType: body.siteType,
          addressLine1: body.addressLine1, addressLine2: body.addressLine2, city: body.city,
          region: body.region, postalCode: body.postalCode, countryCode: body.countryCode,
          status: "active", version: 1, projects: [],
        };
        parent.sites.push(created);
        return ok({ site: created }, 201);
      }
      const parent = findIn(server, "site", body.siteId);
      if (!parent) return fail(404, "That site could not be found.");
      const created = {
        id: `forge_prj_new${counters.project++}`, name: body.name, projectCode: body.projectCode,
        description: body.description, projectType: body.projectType,
        plannedStart: body.plannedStart, plannedFinish: body.plannedFinish,
        status: "planned", version: 1, packageCount: 0,
      };
      parent.projects.push(created);
      return ok({ project: created }, 201);
    }
    if (method === "PATCH") {
      const record = findIn(server, body.entity, body.id);
      if (!record) return fail(404, "That record could not be found.");
      if (body.expectedVersion !== record.version) {
        return fail(409, "This record was changed by someone else. Reload and try again.");
      }
      for (const [key, value] of Object.entries(body)) {
        if (["entity", "id", "expectedVersion", "requestId"].includes(key)) continue;
        if (key === "clientId" || key === "siteId") continue;
        if (value !== null && value !== undefined) record[key] = value;
      }
      record.version += 1;
      const key = body.entity === "client" ? "client" : body.entity === "site" ? "site" : "project";
      return ok({ [key]: record });
    }
    if (method === "DELETE") {
      const record = findIn(server, body.entity, body.id);
      if (!record) return fail(404, "That record could not be found.");
      if (body.expectedVersion !== record.version) {
        return fail(409, "This record was changed by someone else. Reload and try again.");
      }
      if (record.status !== "archived") {
        return fail(409, "Archive the record first — only archived records can be permanently deleted.");
      }
      if (body.entity === "client" && (record.sites ?? []).length > 0) {
        return fail(409, `That record still has items under it (${record.sites.length} site${record.sites.length === 1 ? "" : "s"}). Remove or move the sites first.`);
      }
      if (body.entity === "site" && (record.projects ?? []).length > 0) {
        return fail(409, `That record still has items under it (${record.projects.length} project${record.projects.length === 1 ? "" : "s"}). Remove or move the projects first.`);
      }
      if (body.entity === "project" && (record.packageCount || 0) > 0) {
        return fail(409, `That record still has items under it (${record.packageCount} assigned package${record.packageCount === 1 ? "" : "s"}). Unassign or explicitly move packages first.`);
      }
      for (const client of server.clients) {
        if (body.entity === "client" && client.id === body.id) {
          server.clients = server.clients.filter((c) => c.id !== body.id);
        }
        for (const site of client.sites ?? []) {
          if (body.entity === "site" && site.id === body.id) {
            client.sites = client.sites.filter((s) => s.id !== body.id);
          }
          site.projects = (site.projects ?? []).filter((p) => !(body.entity === "project" && p.id === body.id));
        }
      }
      return ok({ deleted: true });
    }
    throw new Error(`unexpected method ${method}`);
  }));
  return {
    calls,
    get server() { return server; },
    get testServer() { return testServer; },
    mutate(fn) { fn(server); },
  };
}

const activeRoots = [];

function renderManager() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  activeRoots.push(root);
  act(() => {
    root.render(<PlannerHierarchyManager />);
  });
  return { container, root };
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

function buttonByLabel(container, label) {
  const el = container.querySelector(`[aria-label="${label}"]`);
  if (!el) throw new Error(`no button with aria-label "${label}"`);
  return el;
}

function buttonByText(container, text) {
  const el = [...container.querySelectorAll("button")].find((n) => n.textContent.trim() === text);
  if (!el) throw new Error(`no button with text "${text}"`);
  return el;
}

function nameInput(container) {
  return container.querySelector("#hierarchy-form-name");
}

afterEach(() => {
  for (const root of activeRoots.splice(0)) {
    try { act(() => { root.unmount(); }); } catch { /* already unmounted */ }
  }
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("PlannerHierarchyManager", () => {
  it("loads the full inventory (archived rows included) and renders the tree with statuses and counts", async () => {
    const { calls } = stubFetch();
    const { container } = renderManager();
    await flush();
    expect(calls[0].url).toBe("/api/forge/hierarchy?includeArchived=true");
    expect(container.textContent).toContain("Acme");
    expect(container.textContent).toContain("Plant 1");
    expect(container.textContent).toContain("Turnaround");
    expect(container.textContent).toContain("TA-01");
    expect(container.textContent).toContain("Revamp");
    expect(container.textContent).toContain("Archived");
    expect(container.textContent).toContain("Beta");
    expect(container.textContent).toContain("2 clients · 2 sites · 2 projects");
    expect(container.textContent).toContain("2 assigned packages");
  });

  it("is read-only without the manage capability: no create/edit/delete controls", async () => {
    stubFetch({ canManage: false });
    const { container } = renderManager();
    await flush();
    expect(container.querySelector("[aria-label='Edit Acme']")).toBeNull();
    expect(container.querySelector("[aria-label='Delete Acme']")).toBeNull();
    expect([...container.querySelectorAll("button")].some((b) => b.textContent.trim() === "New client")).toBe(false);
    expect(container.textContent).toContain("cannot change it");
  });

  it("creates a client and confirms in plain words beside Save", async () => {
    const { calls } = stubFetch();
    const { container } = renderManager();
    await flush();
    click(buttonByText(container, "New client"));
    setInputValue(nameInput(container), "Acme Industrial");
    click(buttonByText(container, "Save"));
    await flush();
    const post = calls.find((c) => c.method === "POST");
    expect(post).toBeDefined();
    expect(post.body.entity).toBe("client");
    expect(post.body.name).toBe("Acme Industrial");
    expect(typeof post.body.requestId).toBe("string");
    expect(post.body.requestId.length).toBeGreaterThan(0);
    expect(container.textContent).toContain("Acme Industrial saved.");
    expect(container.textContent).toContain("Acme Industrial");
  });

  it("refuses to create a client with no name and sends nothing", async () => {
    const { calls } = stubFetch();
    const { container } = renderManager();
    await flush();
    click(buttonByText(container, "New client"));
    click(buttonByText(container, "Save"));
    await flush();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
    expect(container.textContent).toContain("Enter a name");
  });

  it("shows the server's duplicate-name error inline and sends no further write", async () => {
    const { calls } = stubFetch();
    const { container } = renderManager();
    await flush();
    click(buttonByText(container, "New client"));
    setInputValue(nameInput(container), "Acme");
    click(buttonByText(container, "Save"));
    await flush();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
    expect(container.textContent).toContain("A client with that name already exists.");
    expect(container.textContent).not.toContain("Acme saved.");
  });

  it("saves nothing on an unchanged edit and confirms truthfully", async () => {
    const { calls } = stubFetch();
    const { container } = renderManager();
    await flush();
    click(buttonByLabel(container, "Edit Acme"));
    click(buttonByText(container, "Save"));
    await flush();
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
    expect(container.textContent).toContain("No changes to Acme — nothing needed saving.");
  });

  it("edits a client with the current version and confirms by name", async () => {
    const { calls } = stubFetch();
    const { container } = renderManager();
    await flush();
    click(buttonByLabel(container, "Edit Acme"));
    setInputValue(nameInput(container), "Acme Corp");
    click(buttonByText(container, "Save"));
    await flush();
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch).toBeDefined();
    expect(patch.body.entity).toBe("client");
    expect(patch.body.id).toBe("forge_cli_1");
    expect(patch.body.name).toBe("Acme Corp");
    expect(patch.body.expectedVersion).toBe(3);
    expect(typeof patch.body.requestId).toBe("string");
    expect(container.textContent).toContain("Acme Corp saved.");
  });

  it("reconciles a stale version: keeps the draft, shows the fresh version, retries with it", async () => {
    const api = stubFetch();
    const { container } = renderManager();
    await flush();
    click(buttonByLabel(container, "Edit Acme"));
    setInputValue(nameInput(container), "Acme Corp");
    // Another user saves first: the server version moves to 4.
    api.mutate((server) => {
      const client = server.clients.find((c) => c.id === "forge_cli_1");
      client.version = 4;
      client.status = "inactive";
    });
    click(buttonByText(container, "Save"));
    await flush();
    expect(api.calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
    expect(container.textContent).toContain("changed by someone else");
    expect(container.textContent).toContain("now version 4");
    expect(container.textContent).toContain("Inactive");
    // The user's typed name is still in the form.
    expect(nameInput(container).value).toBe("Acme Corp");
    // Retry with the fresh version.
    click(buttonByText(container, "Save"));
    await flush();
    const patches = api.calls.filter((c) => c.method === "PATCH");
    expect(patches).toHaveLength(2);
    expect(patches[1].body.expectedVersion).toBe(4);
    expect(container.textContent).toContain("Acme Corp saved.");
  });

  it("archives a project from the row and confirms by name", async () => {
    const { calls } = stubFetch();
    const { container } = renderManager();
    await flush();
    click(buttonByLabel(container, "Archive Turnaround"));
    await flush();
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch).toBeDefined();
    expect(patch.body.entity).toBe("project");
    expect(patch.body.id).toBe("forge_prj_1");
    expect(patch.body.status).toBe("archived");
    expect(patch.body.expectedVersion).toBe(5);
    expect(container.textContent).toContain('Archived "Turnaround".');
  });

  it("restores an archived project from the row", async () => {
    const { calls } = stubFetch();
    const { container } = renderManager();
    await flush();
    click(buttonByLabel(container, "Restore Revamp"));
    await flush();
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch.body.status).toBe("active");
    expect(patch.body.expectedVersion).toBe(1);
    expect(container.textContent).toContain('Restored "Revamp".');
  });

  it("blocks delete with the reason shown: archive first, then children or packages", async () => {
    stubFetch();
    const { container } = renderManager();
    await flush();
    // Active records: the first blocker is the archive-first rule.
    const clientDelete = buttonByLabel(container, "Delete Acme");
    expect(clientDelete.disabled).toBe(true);
    expect(container.textContent).toContain('Archive "Acme" first — only archived records can be permanently deleted.');
    const projectDelete = buttonByLabel(container, "Delete Turnaround");
    expect(projectDelete.disabled).toBe(true);
    // Once archived, the dependency reason takes over.
    click(buttonByLabel(container, "Archive Turnaround"));
    await flush();
    expect(container.textContent).toContain("This project still has 2 assigned packages. Unassign or explicitly move packages first.");
    click(buttonByLabel(container, "Archive Acme"));
    await flush();
    expect(container.textContent).toContain("This client still has 2 sites. Remove or move the sites first.");
  });

  it("deletes an archived empty project only after a second confirmation", async () => {
    const { calls } = stubFetch();
    const { container } = renderManager();
    await flush();
    click(buttonByLabel(container, "Delete Revamp"));
    expect(container.textContent).toContain("Permanently delete this project?");
    expect(container.textContent).toContain('"Revamp"');
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
    click(buttonByText(container, "Delete permanently"));
    await flush();
    const del = calls.find((c) => c.method === "DELETE");
    expect(del).toBeDefined();
    expect(del.body.entity).toBe("project");
    expect(del.body.id).toBe("forge_prj_2");
    expect(del.body.expectedVersion).toBe(1);
    expect(container.textContent).toContain('Deleted "Revamp".');
  });

  it("surfaces the server's delete block in the brief's words when children appear mid-flow", async () => {
    const api = stubFetch();
    const { container } = renderManager();
    await flush();
    // Revamp renders deletable (0 packages), then a package is assigned.
    api.mutate((server) => {
      const project = server.clients[0].sites[0].projects.find((p) => p.id === "forge_prj_2");
      project.packageCount = 1;
    });
    click(buttonByLabel(container, "Delete Revamp"));
    click(buttonByText(container, "Delete permanently"));
    await flush();
    expect(api.calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
    expect(container.textContent).toContain("Unassign or explicitly move packages first.");
    expect(container.textContent).not.toContain('Deleted "Revamp".');
  });

  it("search narrows the tree to the matching branch", async () => {
    stubFetch();
    const { container } = renderManager();
    await flush();
    setInputValue(container.querySelector("#hierarchy-search"), "Turnaround");
    expect(container.textContent).toContain("Turnaround");
    expect(container.textContent).not.toContain("Beta");
    expect(container.textContent).not.toContain("Plant 2");
    expect(container.textContent).toContain("Acme");
  });

  it("status filter shows only archived rows and their ancestors", async () => {
    stubFetch();
    const { container } = renderManager();
    await flush();
    setInputValue(container.querySelector("#hierarchy-status-filter"), "archived");
    expect(container.textContent).toContain("Beta");
    expect(container.textContent).toContain("Revamp");
    expect(container.textContent).not.toContain("Turnaround");
    expect(container.textContent).not.toContain("Plant 2");
  });

  it("links back to Planner, Unassigned packages, and Planner Admin", async () => {
    stubFetch();
    const { container } = renderManager();
    await flush();
    const links = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toContain("/forge/work");
    expect(links).toContain("/forge/work?forgeProject=unassigned");
    expect(links).toContain("/forge/work/admin");
  });

  // P1 (PR #811 review): clearing an editable optional field must
  // send the explicit empty string, not null — the RPC contract is
  // null = unchanged, "" = clear. Sending null silently kept the old
  // value while the UI still said "saved".
  it("clearing client notes sends an empty string and the reload shows the field empty", async () => {
    const tree = structuredClone(BASE_TREE);
    tree.clients[0].notes = "Old note";
    const { calls } = stubFetch({ tree });
    const { container } = renderManager();
    await flush();
    click(buttonByLabel(container, "Edit Acme"));
    const notes = container.querySelector("#hierarchy-form-notes");
    expect(notes.value).toBe("Old note");
    setInputValue(notes, "");
    click(buttonByText(container, "Save"));
    await flush();
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch).toBeDefined();
    expect(patch.body.notes).toBe("");
    expect(patch.body.externalReference).toBe("ACME-1");
    expect(container.textContent).toContain("Acme saved.");
    // A true clear, not a false success: the reload repopulates empty.
    expect(container.querySelector("#hierarchy-form-notes").value).toBe("");
    // A second Save is a truthful no-op — the clear is not re-sent.
    const patchCount = calls.filter((c) => c.method === "PATCH").length;
    click(buttonByText(container, "Save"));
    await flush();
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(patchCount);
    expect(container.textContent).toContain("No changes to Acme — nothing needed saving.");
  });

  it("clearing site city and type sends empty strings and the reload shows them empty", async () => {
    const tree = structuredClone(BASE_TREE);
    tree.clients[0].sites[0].city = "Beaumont";
    tree.clients[0].sites[0].siteType = "industrial";
    const { calls } = stubFetch({ tree });
    const { container } = renderManager();
    await flush();
    click(buttonByLabel(container, "Edit Plant 1"));
    const city = container.querySelector("#hierarchy-form-city");
    expect(city.value).toBe("Beaumont");
    setInputValue(city, "");
    setInputValue(container.querySelector("#hierarchy-form-site-type"), "");
    click(buttonByText(container, "Save"));
    await flush();
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch).toBeDefined();
    expect(patch.body.city).toBe("");
    expect(patch.body.siteType).toBe("");
    expect(container.textContent).toContain("Plant 1 saved.");
    expect(container.querySelector("#hierarchy-form-city").value).toBe("");
    expect(container.querySelector("#hierarchy-form-site-type").value).toBe("");
    const patchCount = calls.filter((c) => c.method === "PATCH").length;
    click(buttonByText(container, "Save"));
    await flush();
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(patchCount);
    expect(container.textContent).toContain("No changes to Plant 1 — nothing needed saving.");
  });

  it("clearing project description and planned start sends empty strings and the reload shows them empty", async () => {
    const tree = structuredClone(BASE_TREE);
    const project = tree.clients[0].sites[0].projects[0];
    project.description = "Old desc";
    project.plannedStart = "2026-01-15";
    project.plannedFinish = "2026-06-30";
    const { calls } = stubFetch({ tree });
    const { container } = renderManager();
    await flush();
    click(buttonByLabel(container, "Edit Turnaround"));
    setInputValue(container.querySelector("#hierarchy-form-description"), "");
    setInputValue(container.querySelector("#hierarchy-form-planned-start"), "");
    click(buttonByText(container, "Save"));
    await flush();
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch).toBeDefined();
    expect(patch.body.description).toBe("");
    expect(patch.body.plannedStart).toBe("");
    expect(patch.body.plannedFinish).toBe("2026-06-30");
    expect(container.textContent).toContain("Turnaround saved.");
    expect(container.querySelector("#hierarchy-form-description").value).toBe("");
    expect(container.querySelector("#hierarchy-form-planned-start").value).toBe("");
    const patchCount = calls.filter((c) => c.method === "PATCH").length;
    click(buttonByText(container, "Save"));
    await flush();
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(patchCount);
    expect(container.textContent).toContain("No changes to Turnaround — nothing needed saving.");
  });

  // Owner-only test data (migration 20261117120000/130000): the Test
  // data section, Real/Test switch, TEST badges, test-create, sample
  // load, and purge preview/confirm exist only when the server says
  // the authenticated actor may use owner test data. A co-owner or
  // member never sees the section, the switch, or any test name.
  it("owner: shows the Test data section with a Real/Test switch; Test mode shows only test rows with TEST badges", async () => {
    stubFetch({ canUseOwnerTestData: true });
    const { container } = renderManager();
    await flush();
    expect(container.querySelector("[data-testid='planner-test-data-section']")).not.toBeNull();
    expect(container.textContent).toContain("TEST — OWNER ONLY");
    // Real mode first: the real tree, no test names.
    expect(container.textContent).toContain("Acme");
    expect(container.textContent).not.toContain("Fictional Test Client");
    click(buttonByText(container, "Test"));
    await flush();
    expect(container.textContent).toContain("Fictional Test Client");
    expect(container.textContent).toContain("Fictional Test Site");
    expect(container.textContent).toContain("Fictional Test Project");
    expect(container.textContent).not.toContain("Acme");
    expect(container.textContent).not.toContain("Turnaround");
    // TEST badges on every level of the test tree (the client badge
    // reads "TEST — OWNER ONLY", site/project badges read "TEST").
    const badges = [...container.querySelectorAll("span")].filter((n) => n.textContent.trim().startsWith("TEST"));
    expect(badges.length).toBeGreaterThanOrEqual(3);
    // Back to Real restores the real tree.
    click(buttonByText(container, "Real"));
    await flush();
    expect(container.textContent).toContain("Acme");
    expect(container.textContent).not.toContain("Fictional Test Client");
  });

  it("co-owner/member: no Test data section, no switch, no test name anywhere", async () => {
    stubFetch({ canUseOwnerTestData: false });
    const { container } = renderManager();
    await flush();
    expect(container.querySelector("[data-testid='planner-test-data-section']")).toBeNull();
    expect(container.textContent).not.toContain("Test data");
    expect(container.textContent).not.toContain("Fictional Test Client");
    expect([...container.querySelectorAll("button")].map((n) => n.textContent.trim())).not.toContain("Test");
  });

  it("owner in Test mode: New test client posts isTest true and confirms by name", async () => {
    const { calls } = stubFetch({ canUseOwnerTestData: true });
    const { container } = renderManager();
    await flush();
    click(buttonByText(container, "Test"));
    await flush();
    click(buttonByText(container, "New test client"));
    setInputValue(nameInput(container), "Second Test Client");
    click(buttonByText(container, "Save"));
    await flush();
    const create = calls.find((c) => c.method === "POST" && c.body?.entity === "client" && c.body?.isTest === true);
    expect(create).toBeDefined();
    expect(create.body.name).toBe("Second Test Client");
    expect(container.textContent).toContain("Second Test Client saved.");
    expect(container.textContent).toContain("Second Test Client");
  });

  it("owner in Test mode: Load sample packages posts the project and confirms in plain words", async () => {
    const { calls } = stubFetch({ canUseOwnerTestData: true });
    const { container } = renderManager();
    await flush();
    click(buttonByText(container, "Test"));
    await flush();
    click(buttonByLabel(container, "Load sample packages into Fictional Test Project"));
    await flush();
    const load = calls.find((c) => String(c.url).startsWith("/api/forge/planner/test-data/load"));
    expect(load).toBeDefined();
    expect(load.body.projectId).toBe("forge_prj_test1");
    expect(typeof load.body.requestId).toBe("string");
    expect(container.textContent).toContain("Loaded 6 sample packages / 31 steps");
  });

  it("owner in Test mode: purge preview shows counts, requires the typed name, then deletes and confirms", async () => {
    const { calls } = stubFetch({ canUseOwnerTestData: true });
    const { container } = renderManager();
    await flush();
    click(buttonByText(container, "Test"));
    await flush();
    click(buttonByLabel(container, "Preview cleanup of Fictional Test Client"));
    await flush();
    const previewCall = calls.find((c) => String(c.url).startsWith("/api/forge/planner/test-data/preview"));
    expect(previewCall).toBeDefined();
    expect(previewCall.body.clientId).toBe("forge_cli_test1");
    expect(container.querySelector("[data-testid='purge-preview-forge_cli_test1']")).not.toBeNull();
    expect(container.textContent).toContain("Delete test data for");
    // The delete button stays disabled until the name matches exactly.
    const deleteButton = buttonByText(container, "Delete test data");
    expect(deleteButton.disabled).toBe(true);
    const confirmInput = container.querySelector("#purge-confirm-forge_cli_test1");
    setInputValue(confirmInput, "Wrong Name");
    expect(deleteButton.disabled).toBe(true);
    setInputValue(confirmInput, "Fictional Test Client");
    expect(deleteButton.disabled).toBe(false);
    click(deleteButton);
    await flush();
    const purgeCall = calls.find((c) => String(c.url).startsWith("/api/forge/planner/test-data/purge"));
    expect(purgeCall).toBeDefined();
    expect(purgeCall.body.clientId).toBe("forge_cli_test1");
    expect(purgeCall.body.confirmName).toBe("Fictional Test Client");
    expect(purgeCall.body.digest).toBe("a".repeat(64));
    expect(container.textContent).toContain("Test data deleted");
    expect(container.querySelector("[data-testid='hierarchy-row-client-forge_cli_test1']")).toBeNull();
  });
});
