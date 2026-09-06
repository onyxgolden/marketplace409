// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SchedulingResourcesModal from "./SchedulingResourcesModal";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function jsonResponse(body, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) });
}
function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  return { container, root };
}
function unmount({ container, root }) {
  act(() => root.unmount());
  container.remove();
}
async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}
function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("SchedulingResourcesModal", () => {
  let mounted;
  beforeEach(() => { global.fetch = vi.fn(); });
  afterEach(() => {
    if (mounted) unmount(mounted);
    mounted = null;
    vi.restoreAllMocks();
  });

  it("lists resources on open", async () => {
    global.fetch.mockReturnValueOnce(jsonResponse({ success: true, resources: [{ id: "resource_1", name: "Framing Crew", resource_type: "labor", max_units_per_day: 8, std_rate: 50, is_active: true }] }));
    mounted = mount(<SchedulingResourcesModal isOwner onClose={() => {}} />);
    await flush();
    expect(mounted.container.textContent).toContain("Framing Crew");
    expect(global.fetch).toHaveBeenCalledWith("/api/forge/scheduling/resources");
  });

  it("shows the add form for an owner, and hides it for a read-only viewer", async () => {
    global.fetch.mockReturnValue(jsonResponse({ success: true, resources: [] }));
    const owner = mount(<SchedulingResourcesModal isOwner onClose={() => {}} />);
    await flush();
    expect(owner.container.textContent).toContain("Add a resource");
    unmount(owner);

    const viewer = mount(<SchedulingResourcesModal isOwner={false} onClose={() => {}} />);
    await flush();
    expect(viewer.container.textContent).not.toContain("Add a resource");
    unmount(viewer);
    mounted = null;
  });

  it("creates a resource, refreshes the list, and notifies onChanged", async () => {
    const onChanged = vi.fn();
    global.fetch
      .mockReturnValueOnce(jsonResponse({ success: true, resources: [] }))
      .mockReturnValueOnce(jsonResponse({ success: true, resourceId: "resource_new" }))
      .mockReturnValueOnce(jsonResponse({ success: true, resources: [{ id: "resource_new", name: "Electrician", resource_type: "labor", max_units_per_day: 8, std_rate: 0, is_active: true }] }));
    mounted = mount(<SchedulingResourcesModal isOwner onClose={() => {}} onChanged={onChanged} />);
    await flush();

    setInputValue(mounted.container.querySelector("[data-scheduling-resource-name-input]"), "Electrician");
    const addButton = mounted.container.querySelector("[data-scheduling-add-resource]");
    await act(async () => { addButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); await flush(); });

    expect(global.fetch).toHaveBeenCalledWith("/api/forge/scheduling/resources", expect.objectContaining({ method: "POST" }));
    expect(mounted.container.textContent).toContain("Resource added.");
    expect(mounted.container.textContent).toContain("Electrician");
    expect(onChanged).toHaveBeenCalled();
  });

  it("loads a template's starter resource set, skipping names that already exist", async () => {
    const onChanged = vi.fn();
    global.fetch.mockReturnValueOnce(jsonResponse({ success: true, resources: [] }));
    mounted = mount(<SchedulingResourcesModal isOwner onClose={() => {}} onChanged={onChanged} templateId="capital" />);
    await flush();

    // Every remaining call is either a create POST (resolved ok/409 in order) or the final refetch.
    global.fetch.mockImplementation((url, init) => {
      if (init?.method === "POST") {
        return jsonResponse({ error: "A resource with that name already exists." }, false).then((r) => ({ ...r, status: 409 }));
      }
      return jsonResponse({ success: true, resources: [{ id: "resource_1", name: "Pipefitter Crew", resource_type: "labor", max_units_per_day: 8, std_rate: 65, is_active: true }] });
    });

    const loadButton = mounted.container.querySelector("[data-scheduling-load-starter-resources-button]");
    await act(async () => { loadButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); await flush(); });

    expect(mounted.container.textContent).toMatch(/already existed/);
    expect(onChanged).toHaveBeenCalled();
  });

  it("defaults the starter-set picker to the project's own template", async () => {
    global.fetch.mockReturnValue(jsonResponse({ success: true, resources: [] }));
    mounted = mount(<SchedulingResourcesModal isOwner onClose={() => {}} templateId="home_remodel" />);
    await flush();

    const select = mounted.container.querySelector("[data-scheduling-load-starter-resources] select");
    expect(select.value).toBe("home_remodel");
  });

  it("shows a clear error when deleting a resource still in use", async () => {
    global.fetch
      .mockReturnValueOnce(jsonResponse({ success: true, resources: [{ id: "resource_1", name: "Framing Crew", resource_type: "labor", max_units_per_day: 8, std_rate: 50, is_active: true }] }))
      .mockReturnValueOnce(jsonResponse({ error: "This resource has assignments on one or more activities -- remove those first, or deactivate the resource instead of deleting it." }, false));
    mounted = mount(<SchedulingResourcesModal isOwner onClose={() => {}} />);
    await flush();

    const deleteButton = [...mounted.container.querySelectorAll("button")].find((button) => button.textContent === "Delete");
    await act(async () => { deleteButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); await flush(); });

    expect(mounted.container.textContent).toContain("remove those first");
  });
});
