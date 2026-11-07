// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearSWRCache } from "@/hooks/swrCache";

import WorkPackagePermitAnnotations from "./WorkPackagePermitAnnotations.jsx";

const ACTIVE = {
  id: "forge_wppa_1", workPackageId: "pkg_1", targetKind: "package",
  drawingId: null, originalDrawingId: null,
  label: "City permit portal", url: "https://example.com/permits/9",
  permitReference: "PERMIT-42", note: "Apply online", version: 1,
  retiredAt: null, retiredBy: null, createdBy: "user_1", updatedBy: "user_1",
  createdAt: "t1", updatedAt: "t1",
};
const RETIRED = {
  ...ACTIVE, id: "forge_wppa_2", label: "Old portal", version: 2,
  retiredAt: "t2", retiredBy: "user_1",
};

function setupFetch({ list = [ACTIVE], revisions = [] } = {}) {
  let currentList = [...list];
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET", body: options.body });
    const parsed = new URL(url, "https://test");
    if (parsed.pathname === "/api/work-packages/pkg_1/permit-annotations" && !options.method) {
      const includeRetired = parsed.searchParams.get("includeRetired") === "true";
      const rows = includeRetired ? currentList : currentList.filter((a) => !a.retiredAt);
      return { ok: true, json: async () => ({ annotations: rows }) };
    }
    if (parsed.pathname === "/api/work-packages/pkg_1/permit-annotations" && options.method === "POST") {
      const body = JSON.parse(options.body);
      const created = { ...ACTIVE, id: "forge_wppa_new", label: body.label, url: body.url, version: 1 };
      currentList = [created, ...currentList];
      return { ok: true, json: async () => ({ annotation: created }) };
    }
    if (parsed.pathname === "/api/work-packages/pkg_1/permit-annotations/forge_wppa_1" && options.method === "PATCH") {
      const body = JSON.parse(options.body);
      const updated = { ...ACTIVE, ...body, version: 2 };
      currentList = currentList.map((a) => (a.id === ACTIVE.id ? updated : a));
      return { ok: true, json: async () => ({ annotation: updated }) };
    }
    if (parsed.pathname === "/api/work-packages/pkg_1/permit-annotations/forge_wppa_1/retire" && options.method === "POST") {
      const retired = { ...ACTIVE, version: 2, retiredAt: "t2", retiredBy: "user_1" };
      currentList = currentList.map((a) => (a.id === ACTIVE.id ? retired : a));
      return { ok: true, json: async () => ({ annotation: retired }) };
    }
    if (parsed.pathname === "/api/work-packages/pkg_1/permit-annotations/forge_wppa_1/revisions") {
      return { ok: true, json: async () => ({ revisions }) };
    }
    throw new Error(`unexpected fetch ${options.method || "GET"} ${url}`);
  }));
  return { calls, getList: () => currentList };
}

async function renderPanel(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<WorkPackagePermitAnnotations packageId="pkg_1" scope="package" {...props} />);
  });
  await act(async () => {});
  return { container, root };
}

function buttonByText(container, text) {
  return [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
}

function setInput(container, labelText, value) {
  const inputs = [...container.querySelectorAll("input")];
  const input = inputs.find((el) => el.getAttribute("aria-label") === labelText)
    || inputs.find((el) => el.placeholder === labelText)
    || inputs.find((el) => container.querySelector(`label[for="${el.id}"]`)?.textContent.includes(labelText));
  if (!input) throw new Error(`no input for ${labelText}`);
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSWRCache();
  document.body.innerHTML = "";
});

describe("WorkPackagePermitAnnotations", () => {
  it("renders links as safe external links (new tab, no opener) with reference and version", async () => {
    setupFetch();
    const { container } = await renderPanel();
    const link = container.querySelector('a[href="https://example.com/permits/9"]');
    expect(link).not.toBeNull();
    expect(link.textContent).toBe("City permit portal");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(container.textContent).toContain("Ref: PERMIT-42");
    expect(container.textContent).toContain("v1");
  });

  it("creates a link through the API and confirms it by name", async () => {
    const { calls } = setupFetch({ list: [] });
    const { container } = await renderPanel();
    expect(container.textContent).toContain("No permit links yet.");
    setInput(container, "e.g. City permit portal", "County portal");
    setInput(container, "https://…", "https://county.example.gov/permits");
    await act(async () => { buttonByText(container, "Add link").click(); });
    await act(async () => {});
    const post = calls.find((c) => c.method === "POST");
    expect(post).toBeDefined();
    expect(JSON.parse(post.body)).toMatchObject({
      targetKind: "package", label: "County portal", url: "https://county.example.gov/permits",
    });
    expect(container.textContent).toContain("Permit link added — “County portal”.");
  });

  it("hides retired links until the checkbox is checked", async () => {
    setupFetch({ list: [ACTIVE, RETIRED] });
    const { container } = await renderPanel();
    expect(container.textContent).toContain("City permit portal");
    expect(container.textContent).not.toContain("Old portal");
    const checkbox = container.querySelector('input[type="checkbox"]');
    await act(async () => { checkbox.click(); });
    await act(async () => {});
    expect(container.textContent).toContain("Old portal");
    expect(container.textContent).toContain("Retired");
  });

  it("edits a link with its expected version and confirms by name", async () => {
    const { calls } = setupFetch();
    const { container } = await renderPanel();
    await act(async () => { buttonByText(container, "Edit").click(); });
    setInput(container, "Label", "Renamed portal");
    await act(async () => { buttonByText(container, "Save changes").click(); });
    await act(async () => {});
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch).toBeDefined();
    expect(JSON.parse(patch.body)).toMatchObject({ expectedVersion: 1, label: "Renamed portal" });
    expect(container.textContent).toContain("Permit link updated — “Renamed portal”.");
  });

  it("retires a link with its expected version and confirms by name", async () => {
    const { calls } = setupFetch();
    const { container } = await renderPanel();
    await act(async () => { buttonByText(container, "Retire").click(); });
    await act(async () => { buttonByText(container, "Retire this link").click(); });
    await act(async () => {});
    const retire = calls.find((c) => c.url.endsWith("/retire"));
    expect(retire).toBeDefined();
    expect(JSON.parse(retire.body)).toMatchObject({ expectedVersion: 1 });
    expect(container.textContent).toContain("Permit link retired — “City permit portal”.");
  });

  it("shows the revision history with plain-English actions", async () => {
    setupFetch({
      revisions: [
        { id: "r1", action: "create", version: 1, actorId: "user_1", oldValues: null, newValues: { label: "City permit portal" }, reason: null, recordedAt: "t1" },
        { id: "r2", action: "update", version: 2, actorId: "user_1", oldValues: { label: "Old" }, newValues: { label: "City permit portal" }, reason: "renamed", recordedAt: "t2" },
      ],
    });
    const { container } = await renderPanel();
    await act(async () => { buttonByText(container, "History").click(); });
    await act(async () => {});
    expect(container.textContent).toContain("Added");
    expect(container.textContent).toContain("Edited");
    expect(container.textContent).toContain("renamed");
  });
});
