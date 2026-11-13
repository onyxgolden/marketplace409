// @vitest-environment jsdom
// Foundation PR B — WorkPackageProjectLink tests (mocked fetch +
// mocked router). The assignment flow: pick a target, see the move
// in plain words, confirm, save through the project-link RPC with
// the package's version and a fresh request id; a stale version
// surfaces the plain-words error with a refresh prompt.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockPush = vi.hoisted(() => vi.fn());
const mockRefresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

import WorkPackageProjectLink from "./WorkPackageProjectLink.jsx";

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
      ],
    },
  ],
};
const SELECTION = {
  client: { id: "forge_cli_1", name: "Acme" },
  site: { id: "forge_site_1", name: "Plant 1" },
  project: { id: "forge_prj_1", name: "Turnaround" },
};

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function pick(select, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
  act(() => {
    setter.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function click(button) {
  act(() => { button.click(); });
}

function findButton(container, text) {
  return [...container.querySelectorAll("button")].find((b) => b.textContent.includes(text));
}

describe("WorkPackageProjectLink", () => {
  let fetchCalls;
  let linkResponse;

  function mockFetch() {
    fetchCalls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, options) => {
      fetchCalls.push({ url, options });
      if (String(url).includes("projectId=")) {
        return { ok: true, json: async () => ({ selection: SELECTION }) };
      }
      if (String(url).includes("/project-link")) {
        return linkResponse;
      }
      return { ok: true, json: async () => ({ selector: TREE }) };
    }));
  }

  function renderLink(props = {}) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onLinked = vi.fn();
    act(() => {
      root.render(
        <WorkPackageProjectLink
          packageId="forge_wp_1"
          packageCode="WP-0007"
          currentForgeProjectId="forge_prj_1"
          version={3}
          onLinked={onLinked}
          {...props}
        />,
      );
    });
    return { container, root, onLinked };
  }

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    mockPush.mockClear();
    mockRefresh.mockClear();
  });

  it("shows the current assignment by name and saves a confirmed move with version + fresh request id", async () => {
    mockFetch();
    linkResponse = {
      ok: true,
      json: async () => ({
        success: true,
        package: { id: "forge_wp_1", code: "WP-0007", version: 4, forge_project_id: "forge_prj_2" },
      }),
    };
    const { container, onLinked } = renderLink();
    await flush();
    expect(container.textContent).toContain("Acme › Plant 1 › Turnaround");
    const [client, site, project] = container.querySelectorAll("select");
    pick(client, "forge_cli_1");
    pick(site, "forge_site_1");
    pick(project, "forge_prj_2");
    const assignButton = findButton(container, "Assign to");
    expect(assignButton).toBeTruthy();
    click(assignButton);
    // The confirm step names both ends in plain words before saving.
    expect(container.textContent).toContain("Move WP-0007 from Acme › Plant 1 › Turnaround to Acme › Plant 1 › Revamp?");
    click(findButton(container, "Confirm"));
    await flush();
    const post = fetchCalls.find((call) => String(call.url).includes("/project-link"));
    expect(post).toBeTruthy();
    expect(post.options.method).toBe("POST");
    const body = JSON.parse(post.options.body);
    expect(body.forgeProjectId).toBe("forge_prj_2");
    expect(body.expectedVersion).toBe(3);
    expect(typeof body.requestId).toBe("string");
    expect(body.requestId.length).toBeGreaterThan(0);
    expect(container.textContent).toContain("WP-0007 is now assigned to Acme › Plant 1 › Revamp.");
    expect(onLinked).toHaveBeenCalledWith(
      expect.objectContaining({ id: "forge_wp_1", forge_project_id: "forge_prj_2" }),
    );
    // The package now lives under a different scope: the page moves there.
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("forgeProject=forge_prj_2"));
  });

  it("a stale version surfaces the plain-words error and offers a refresh", async () => {
    mockFetch();
    linkResponse = {
      ok: false,
      json: async () => ({ error: "This package changed while you were editing — refresh and retry." }),
    };
    const { container, onLinked } = renderLink();
    await flush();
    const [client, site, project] = container.querySelectorAll("select");
    pick(client, "forge_cli_1");
    pick(site, "forge_site_1");
    pick(project, "forge_prj_2");
    click(findButton(container, "Assign to"));
    click(findButton(container, "Confirm"));
    await flush();
    expect(container.textContent).toContain("This package changed while you were editing");
    expect(findButton(container, "Refresh the page")).toBeTruthy();
    expect(onLinked).not.toHaveBeenCalled();
  });

  it("shows Unassigned when the package has no project link", async () => {
    mockFetch();
    const { container } = renderLink({ currentForgeProjectId: null });
    await flush();
    expect(container.textContent).toContain("Currently assigned to: Unassigned");
  });
});
