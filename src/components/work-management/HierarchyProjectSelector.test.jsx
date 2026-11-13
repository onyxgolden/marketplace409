// @vitest-environment jsdom
// Foundation PR B — HierarchyProjectSelector tests (mocked fetch).
// Cascading selects with an atomic reset, disabled cascading, the
// Unassigned inbox entry, and chain pre-selection for the current value.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import HierarchyProjectSelector from "./HierarchyProjectSelector.jsx";

const TREE = {
  ownerId: "owner_1",
  clients: [
    {
      id: "forge_cli_1", name: "Acme", status: "active",
      sites: [
        {
          id: "forge_site_1", name: "Plant 1", status: "active",
          projects: [
            { id: "forge_prj_1", name: "Turnaround", projectCode: "TA-01", status: "active" },
            { id: "forge_prj_2", name: "Revamp", projectCode: null, status: "active" },
          ],
        },
        {
          id: "forge_site_2", name: "Plant 2", status: "active",
          projects: [{ id: "forge_prj_3", name: "Expansion", projectCode: null, status: "planned" }],
        },
      ],
    },
    {
      id: "forge_cli_2", name: "Beta", status: "active",
      sites: [
        {
          id: "forge_site_3", name: "HQ", status: "active",
          projects: [{ id: "forge_prj_4", name: "Office", projectCode: null, status: "active" }],
        },
      ],
    },
  ],
};

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function mockFetchSuccess() {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => ({ selector: TREE }),
  })));
}

function renderSelector(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onSelect = vi.fn();
  act(() => {
    root.render(<HierarchyProjectSelector value="" onSelect={onSelect} {...props} />);
  });
  return { container, root, onSelect };
}

function selects(container) {
  const [client, site, project] = container.querySelectorAll("select");
  return { client, site, project };
}

function pick(select, value) {
  // Controlled selects need the native setter — a plain assignment is
  // swallowed by React's value tracking.
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
  act(() => {
    setter.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("HierarchyProjectSelector", () => {
  it("disables site and project until their parent is chosen", async () => {
    mockFetchSuccess();
    const { container } = renderSelector();
    await flush();
    const { client, site, project } = selects(container);
    expect(client.disabled).toBe(false);
    expect(site.disabled).toBe(true);
    expect(project.disabled).toBe(true);
    expect(site.querySelectorAll("option")).toHaveLength(1);
    expect(project.querySelectorAll("option")).toHaveLength(1);
  });

  it("cascades client -> site -> project and fires onSelect with the chain on a project pick", async () => {
    mockFetchSuccess();
    const { container, onSelect } = renderSelector();
    await flush();
    const { client, site, project } = selects(container);
    pick(client, "forge_cli_1");
    expect(site.disabled).toBe(false);
    expect([...site.querySelectorAll("option")].map((o) => o.textContent)).toEqual([
      "Choose a site…", "Plant 1", "Plant 2",
    ]);
    pick(site, "forge_site_1");
    expect(project.disabled).toBe(false);
    expect([...project.querySelectorAll("option")].map((o) => o.textContent)).toEqual([
      "Choose a project…", "Turnaround (TA-01)", "Revamp",
    ]);
    pick(project, "forge_prj_2");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("forge_prj_2", expect.objectContaining({
      client: expect.objectContaining({ id: "forge_cli_1" }),
      site: expect.objectContaining({ id: "forge_site_1" }),
      project: expect.objectContaining({ id: "forge_prj_2" }),
    }));
  });

  it("changing the client atomically resets site and project (no stale cross-client pick)", async () => {
    mockFetchSuccess();
    const { container, onSelect } = renderSelector();
    await flush();
    const { client, site, project } = selects(container);
    pick(client, "forge_cli_1");
    pick(site, "forge_site_1");
    pick(project, "forge_prj_1");
    expect(onSelect).toHaveBeenCalledTimes(1);
    pick(client, "forge_cli_2");
    const after = selects(container);
    expect(after.site.value).toBe("");
    expect(after.project.value).toBe("");
    expect(after.project.disabled).toBe(true);
    expect([...after.site.querySelectorAll("option")].map((o) => o.textContent)).toEqual([
      "Choose a site…", "HQ",
    ]);
    // The reset itself fires no selection — only a complete pick does.
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("the Unassigned button fires the inbox value", async () => {
    mockFetchSuccess();
    const { container, onSelect } = renderSelector();
    await flush();
    const button = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Unassigned packages",
    );
    expect(button).toBeTruthy();
    act(() => { button.click(); });
    expect(onSelect).toHaveBeenCalledWith("unassigned", null);
  });

  it("pre-selects the current value's chain once the tree loads", async () => {
    mockFetchSuccess();
    const { container } = renderSelector({ value: "forge_prj_3" });
    await flush();
    const { client, site, project } = selects(container);
    expect(client.value).toBe("forge_cli_1");
    expect(site.value).toBe("forge_site_2");
    expect(project.value).toBe("forge_prj_3");
  });

  it("a value the tree does not contain leaves the selects empty (never a substitute)", async () => {
    mockFetchSuccess();
    const { container } = renderSelector({ value: "forge_prj_gone" });
    await flush();
    const { client, site, project } = selects(container);
    expect(client.value).toBe("");
    expect(site.value).toBe("");
    expect(project.value).toBe("");
  });

  it("shows a plain error and disables the selects when the tree fails to load", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ error: "Could not load." }) })));
    const { container } = renderSelector();
    await flush();
    expect(container.querySelector("[role='alert']").textContent).toMatch(/Could not load/);
    const { client } = selects(container);
    expect(client.disabled).toBe(true);
  });
});
