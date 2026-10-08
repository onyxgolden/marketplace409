// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import WorkPackageCreateForm from "./WorkPackageCreateForm";

const CANONICAL_OPTIONS = [
  { slug: "1900-w-decker", label: "1900 W. Decker" },
  { slug: "4800-kent-ave", label: "4800 Kent Ave" },
];

function stubFetch({ properties, failOptions = false } = {}) {
  const posts = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    if (url === "/api/work-packages/property-options") {
      if (failOptions) {
        return { ok: false, json: async () => ({ error: "Unable to complete the request." }) };
      }
      return { ok: true, json: async () => ({ properties }) };
    }
    if (url === "/api/work-packages" && options.method === "POST") {
      posts.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ package: { id: "forge_wp_new", code: "WP-0001" } }) };
    }
    throw new Error(`unexpected fetch ${url}`);
  }));
  return { posts };
}

function renderForm(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<WorkPackageCreateForm {...props} />);
  });
  return { container, root };
}

async function settle() {
  await act(async () => {});
}

function selectProperty(container, value) {
  const select = container.querySelector("#property_id");
  Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set.call(select, value);
  act(() => {
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function submitCreate(container) {
  const form = container.querySelector("form");
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("WorkPackageCreateForm property picker (Slice 2)", () => {
  it("offers 'No property assigned' plus one option per canonical house", async () => {
    stubFetch({ properties: CANONICAL_OPTIONS });
    const { container } = renderForm();
    await settle();
    const select = container.querySelector("#property_id");
    const options = [...select.querySelectorAll("option")].map((option) => ({
      value: option.value, text: option.textContent,
    }));
    expect(options).toEqual([
      { value: "", text: "No property assigned" },
      { value: "1900-w-decker", text: "1900 W. Decker" },
      { value: "4800-kent-ave", text: "4800 Kent Ave" },
    ]);
    // Defaults to unassigned; nothing is silently selected.
    expect(select.value).toBe("");
  });

  it("submits null when no property is chosen", async () => {
    const { posts } = stubFetch({ properties: CANONICAL_OPTIONS });
    const { container } = renderForm();
    await settle();
    await submitCreate(container);
    expect(posts).toHaveLength(1);
    expect(posts[0].property_id).toBeNull();
    expect(push).toHaveBeenCalledWith("/forge/work/forge_wp_new");
  });

  it("submits the canonical slug when a property is chosen", async () => {
    const { posts } = stubFetch({ properties: CANONICAL_OPTIONS });
    const { container } = renderForm();
    await settle();
    selectProperty(container, "4800-kent-ave");
    await submitCreate(container);
    expect(posts).toHaveLength(1);
    expect(posts[0].property_id).toBe("4800-kent-ave");
  });

  it("preselects the property the owner came from (alias slug matched canonically)", async () => {
    stubFetch({ properties: CANONICAL_OPTIONS });
    const { container } = renderForm({ initialPropertyId: "1900-west-decker" });
    await settle();
    expect(container.querySelector("#property_id").value).toBe("1900-w-decker");
  });

  it("never preselects a property the owner does not have", async () => {
    stubFetch({ properties: CANONICAL_OPTIONS });
    const { container } = renderForm({ initialPropertyId: "someone-elses-house" });
    await settle();
    expect(container.querySelector("#property_id").value).toBe("");
  });

  it("shows a plain empty state when the owner has no properties", async () => {
    stubFetch({ properties: [] });
    const { container } = renderForm();
    await settle();
    const select = container.querySelector("#property_id");
    expect([...select.querySelectorAll("option")]).toHaveLength(1);
    expect(container.textContent).toMatch(/No properties yet/);
  });

  it("shows an inline error and stays unassigned when properties fail to load", async () => {
    const { posts } = stubFetch({ failOptions: true });
    const { container } = renderForm();
    await settle();
    expect(container.textContent).toMatch(/Properties could not be loaded/);
    await submitCreate(container);
    expect(posts).toHaveLength(1);
    expect(posts[0].property_id).toBeNull();
  });
});
