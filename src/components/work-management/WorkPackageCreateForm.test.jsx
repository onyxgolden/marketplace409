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

describe("WorkPackageCreateForm Cancel (D4)", () => {
  function cancelLink(container) {
    return [...container.querySelectorAll("a")].find(
      (anchor) => anchor.textContent.trim() === "Cancel",
    );
  }

  function fillTitle(container, value) {
    const title = container.querySelector("#title");
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(title, value);
    act(() => {
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("renders an accessible Cancel link beside Create package", async () => {
    stubFetch({ properties: CANONICAL_OPTIONS });
    const { container } = renderForm();
    await settle();
    const cancel = cancelLink(container);
    expect(cancel).not.toBeUndefined();
    // A real link to the list, not history back: it must work on a direct
    // visit to the create page.
    expect(cancel.getAttribute("href")).toBe("/forge/work");
    expect(cancel.tabIndex).toBe(0);
    expect(cancel.hasAttribute("aria-disabled")).toBe(false);
    const submit = container.querySelector('button[type="submit"]');
    expect(submit.textContent).toContain("Create package");
  });

  it("cancelling a filled form navigates without posting", async () => {
    const { posts } = stubFetch({ properties: CANONICAL_OPTIONS });
    const { container } = renderForm();
    await settle();
    fillTitle(container, "Unsaved turnover package");
    const cancel = cancelLink(container);
    act(() => {
      cancel.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(posts).toHaveLength(0);
    expect(push).not.toHaveBeenCalled();
  });

  it("keeps the cancel target reachable from the keyboard", async () => {
    stubFetch({ properties: CANONICAL_OPTIONS });
    const { container } = renderForm();
    await settle();
    const cancel = cancelLink(container);
    act(() => {
      cancel.focus();
    });
    expect(document.activeElement).toBe(cancel);
    expect(cancel.tabIndex).toBe(0);
    expect(cancel.getAttribute("href")).toBe("/forge/work");
  });

  it("leaves the create flow unchanged alongside Cancel", async () => {
    const { posts } = stubFetch({ properties: CANONICAL_OPTIONS });
    const { container } = renderForm();
    await settle();
    fillTitle(container, "Real package");
    await submitCreate(container);
    expect(posts).toHaveLength(1);
    expect(posts[0].title).toBe("Real package");
    expect(push).toHaveBeenCalledWith("/forge/work/forge_wp_new");
  });
});
