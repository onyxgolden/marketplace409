// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import WorkPackageDetailClient from "./WorkPackageDetailClient";

const BASE_PKG = {
  id: "forge_wp_1",
  code: "WP-0001",
  title: "Turnover",
  status: "draft",
  description: null,
  package_type: "other",
  priority: "normal",
  project_id: null,
  property_id: null,
  planned_start: null,
  planned_finish: null,
  actual_start: null,
  actual_finish: null,
  percent_complete: 0,
  progress_basis: "pct_estimate",
  planned_qty: null,
  planned_unit: null,
  planned_manhours: null,
  earned_qty: null,
  earned_manhours: null,
  actual_manhours: null,
  responsible_party: null,
  scope_baseline_id: null,
  designated_verifier: null,
  blocked_reason: null,
  version: 1,
};

const OPTIONS = [{ slug: "1900-w-decker", label: "1900 W. Decker" }];

function stubFetch({ properties = OPTIONS, failOptions = false } = {}) {
  const patches = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    if (url === "/api/work-packages/property-options") {
      if (failOptions) return { ok: false, json: async () => ({ error: "Unable to complete the request." }) };
      return { ok: true, json: async () => ({ properties }) };
    }
    if (url === `/api/work-packages/${BASE_PKG.id}` && options.method === "PATCH") {
      patches.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ package: { ...BASE_PKG, ...patches[patches.length - 1], property_id: patches[patches.length - 1].property_id ?? null } }) };
    }
    if (url === `/api/work-packages/${BASE_PKG.id}` && (!options.method || options.method === "GET")) {
      return { ok: true, json: async () => ({ package: BASE_PKG, transitions: [], attestations: [], baselines: [], scopeChanges: [], observations: [] }) };
    }
    if (typeof url === "string" && url.startsWith("/api/work-links")) {
      return { ok: true, json: async () => ({ links: [], documents: [] }) };
    }
    if (typeof url === "string" && url.startsWith("/api/work-documents")) {
      return { ok: true, json: async () => ({ documents: [] }) };
    }
    if (typeof url === "string" && url.startsWith("/api/forge/designer")) {
      return { ok: true, json: async () => ({ projects: [] }) };
    }
    throw new Error(`unexpected fetch ${url}`);
  }));
  return { patches };
}

function renderDetail(pkg = BASE_PKG) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <WorkPackageDetailClient
        initial={{
          package: pkg,
          transitions: [],
          attestations: [],
          baselines: [],
          currentBaseline: null,
          scopeChanges: [],
          observations: [],
        }}
        initialLinks={[]}
      />,
    );
  });
  return { container, root };
}

async function settle() {
  await act(async () => {});
}

function propertyField(container) {
  const terms = [...container.querySelectorAll("dt")];
  const term = terms.find((dt) => dt.textContent === "Property");
  return term?.nextElementSibling || null;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("WorkPackageDetailClient property display (Slice 2)", () => {
  it("shows 'No property assigned' when unassigned", () => {
    stubFetch();
    const { container } = renderDetail();
    expect(propertyField(container).textContent).toBe("No property assigned");
  });

  it("shows the linked property label with a link back to the property page", async () => {
    stubFetch();
    const { container } = renderDetail({ ...BASE_PKG, property_id: "1900-w-decker" });
    await settle();
    const field = propertyField(container);
    expect(field.textContent).toBe("1900 W. Decker");
    const link = field.querySelector("a");
    expect(link).not.toBeNull();
    expect(link.getAttribute("href")).toContain("recordId=1900-w-decker");
    expect(link.getAttribute("href")).toContain("propertyId=1900-w-decker");
  });

  it("keeps the edit picker faithful to the current assignment", async () => {
    const { patches } = stubFetch();
    const { container } = renderDetail({ ...BASE_PKG, property_id: "1900-w-decker" });
    await settle();
    const editButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Edit");
    act(() => { editButton.click(); });
    const select = container.querySelector("#edit_property_id");
    expect(select.value).toBe("1900-w-decker");
    // Clearing the picker and saving PATCHes property_id: null.
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set.call(select, "");
    act(() => { select.dispatchEvent(new Event("change", { bubbles: true })); });
    const saveButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Save");
    await act(async () => { saveButton.click(); });
    await settle();
    expect(patches).toHaveLength(1);
    expect(patches[0].property_id).toBeNull();
  });
});
