// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SchedulingCostAccountsModal from "./SchedulingCostAccountsModal";

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

describe("SchedulingCostAccountsModal", () => {
  let mounted;
  beforeEach(() => { global.fetch = vi.fn(); });
  afterEach(() => {
    if (mounted) unmount(mounted);
    mounted = null;
    vi.restoreAllMocks();
  });

  it("lists cost codes on open", async () => {
    global.fetch.mockReturnValueOnce(jsonResponse({ success: true, costAccounts: [{ id: "cost_account_1", code: "PO-4521", name: "Steel supplier" }] }));
    mounted = mount(<SchedulingCostAccountsModal isOwner onClose={() => {}} />);
    await flush();
    expect(mounted.container.textContent).toContain("PO-4521");
    expect(mounted.container.textContent).toContain("Steel supplier");
    expect(global.fetch).toHaveBeenCalledWith("/api/forge/scheduling/cost-accounts");
  });

  it("shows the add form for an owner, and hides it for a read-only viewer", async () => {
    global.fetch.mockReturnValue(jsonResponse({ success: true, costAccounts: [] }));
    const owner = mount(<SchedulingCostAccountsModal isOwner onClose={() => {}} />);
    await flush();
    expect(owner.container.textContent).toContain("Add a cost code");
    unmount(owner);

    const viewer = mount(<SchedulingCostAccountsModal isOwner={false} onClose={() => {}} />);
    await flush();
    expect(viewer.container.textContent).not.toContain("Add a cost code");
    unmount(viewer);
    mounted = null;
  });

  it("creates a cost code, refreshes the list, and notifies onChanged", async () => {
    const onChanged = vi.fn();
    global.fetch
      .mockReturnValueOnce(jsonResponse({ success: true, costAccounts: [] }))
      .mockReturnValueOnce(jsonResponse({ success: true, costAccountId: "cost_account_new" }))
      .mockReturnValueOnce(jsonResponse({ success: true, costAccounts: [{ id: "cost_account_new", code: "WO-1002", name: "Electrical" }] }));
    mounted = mount(<SchedulingCostAccountsModal isOwner onClose={() => {}} onChanged={onChanged} />);
    await flush();

    setInputValue(mounted.container.querySelector("[data-scheduling-cost-account-code-input]"), "WO-1002");
    setInputValue(mounted.container.querySelectorAll("input")[1], "Electrical");
    const addButton = mounted.container.querySelector("[data-scheduling-add-cost-account]");
    await act(async () => { addButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); await flush(); });

    expect(global.fetch).toHaveBeenCalledWith("/api/forge/scheduling/cost-accounts", expect.objectContaining({ method: "POST" }));
    expect(mounted.container.textContent).toContain("Cost code added.");
    expect(mounted.container.textContent).toContain("WO-1002");
    expect(onChanged).toHaveBeenCalled();
  });

  it("shows a clear error when a duplicate code is created", async () => {
    global.fetch
      .mockReturnValueOnce(jsonResponse({ success: true, costAccounts: [] }))
      .mockReturnValueOnce(jsonResponse({ error: "A cost code with that code already exists." }, false));
    mounted = mount(<SchedulingCostAccountsModal isOwner onClose={() => {}} />);
    await flush();

    setInputValue(mounted.container.querySelector("[data-scheduling-cost-account-code-input]"), "PO-4521");
    setInputValue(mounted.container.querySelectorAll("input")[1], "Dup");
    const addButton = mounted.container.querySelector("[data-scheduling-add-cost-account]");
    await act(async () => { addButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); await flush(); });

    expect(mounted.container.textContent).toContain("already exists");
  });

  it("deletes a cost code and refreshes the list", async () => {
    global.fetch
      .mockReturnValueOnce(jsonResponse({ success: true, costAccounts: [{ id: "cost_account_1", code: "PO-4521", name: "Steel supplier" }] }))
      .mockReturnValueOnce(jsonResponse({ success: true }))
      .mockReturnValueOnce(jsonResponse({ success: true, costAccounts: [] }));
    mounted = mount(<SchedulingCostAccountsModal isOwner onClose={() => {}} />);
    await flush();

    const deleteButton = [...mounted.container.querySelectorAll("button")].find((button) => button.textContent === "Delete");
    await act(async () => { deleteButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); await flush(); });

    expect(mounted.container.textContent).not.toContain("PO-4521");
  });
});
