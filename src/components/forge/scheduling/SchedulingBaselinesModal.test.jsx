// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SchedulingBaselinesModal from "./SchedulingBaselinesModal";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BLOCKS = [{ id: "b1", taskCode: "A1010", label: "Charter Approval" }];

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
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("SchedulingBaselinesModal", () => {
  let mounted;

  beforeEach(() => { global.fetch = vi.fn(); });
  afterEach(() => {
    if (mounted) unmount(mounted);
    mounted = null;
    vi.restoreAllMocks();
  });

  it("lists captured baselines on open", async () => {
    global.fetch.mockReturnValueOnce(jsonResponse({ success: true, baselines: [{ id: "baseline_1", name: "Approved plan", createdAt: "2026-01-01T00:00:00.000Z" }] }));
    mounted = mount(<SchedulingBaselinesModal projectId="p1" isOwner blocks={BLOCKS} onClose={() => {}} />);
    await flush();
    expect(mounted.container.textContent).toContain("Approved plan");
    expect(global.fetch).toHaveBeenCalledWith("/api/forge/scheduling/p1/baselines");
  });

  it("shows the capture form for an owner, and hides it for a read-only viewer", async () => {
    global.fetch.mockReturnValue(jsonResponse({ success: true, baselines: [] }));
    const owner = mount(<SchedulingBaselinesModal projectId="p1" isOwner blocks={BLOCKS} onClose={() => {}} />);
    await flush();
    expect(owner.container.textContent).toContain("Capture a new baseline");
    unmount(owner);

    const viewer = mount(<SchedulingBaselinesModal projectId="p1" isOwner={false} blocks={BLOCKS} onClose={() => {}} />);
    await flush();
    expect(viewer.container.textContent).not.toContain("Capture a new baseline");
    unmount(viewer);
    mounted = null;
  });

  it("captures a baseline and refreshes the list", async () => {
    global.fetch
      .mockReturnValueOnce(jsonResponse({ success: true, baselines: [] }))
      .mockReturnValueOnce(jsonResponse({ success: true, baselineId: "baseline_new" }))
      .mockReturnValueOnce(jsonResponse({ success: true, baselines: [{ id: "baseline_new", name: "Kickoff plan", createdAt: "2026-01-01T00:00:00.000Z" }] }));
    mounted = mount(<SchedulingBaselinesModal projectId="p1" isOwner blocks={BLOCKS} onClose={() => {}} />);
    await flush();

    const input = mounted.container.querySelector("input");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    await act(async () => { setter.call(input, "Kickoff plan"); input.dispatchEvent(new Event("input", { bubbles: true })); });

    const captureButton = [...mounted.container.querySelectorAll("button")].find((button) => button.textContent === "Capture baseline");
    await act(async () => { captureButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); await flush(); });

    expect(global.fetch).toHaveBeenCalledWith("/api/forge/scheduling/p1/baselines", expect.objectContaining({
      method: "POST", body: JSON.stringify({ name: "Kickoff plan" }),
    }));
    expect(mounted.container.textContent).toContain("Baseline captured.");
    expect(mounted.container.textContent).toContain("Kickoff plan");
  });

  it("loads and displays variance for a selected baseline, including added-since-baseline blocks", async () => {
    global.fetch
      .mockReturnValueOnce(jsonResponse({ success: true, baselines: [{ id: "baseline_1", name: "Approved plan", createdAt: "2026-01-01T00:00:00.000Z" }] }))
      .mockReturnValueOnce(jsonResponse({
        success: true,
        compared: [{ taskCode: "A1010", startVarianceDays: 0, finishVarianceDays: 3, durationVarianceDays: 3, usedActualStart: false, usedActualFinish: false }],
        addedSinceBaseline: [{ taskCode: "A1020", label: "New scope" }],
        removedSinceBaseline: [],
        rollup: { baselineProjectFinish: "2026-01-07", currentProjectFinish: "2026-01-10", projectFinishVarianceDays: 3 },
      }));
    mounted = mount(<SchedulingBaselinesModal projectId="p1" isOwner blocks={BLOCKS} onClose={() => {}} />);
    await flush();

    const baselineButton = [...mounted.container.querySelectorAll("button")].find((button) => button.textContent.includes("Approved plan"));
    await act(async () => { baselineButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); await flush(); });

    expect(global.fetch).toHaveBeenCalledWith("/api/forge/scheduling/p1/baselines/baseline_1/variance");
    expect(mounted.container.textContent).toContain("A1010 Charter Approval");
    expect(mounted.container.textContent).toContain("3d late");
    expect(mounted.container.textContent).toContain("Added since baseline: New scope");
  });
});
