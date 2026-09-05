// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SchedulingLevelingModal from "./SchedulingLevelingModal";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BLOCKS = [{ id: "b1", taskCode: "A1010", label: "Framing" }];

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

const PREVIEW = {
  success: true, projectFinishExtensionDays: 0, unresolvedConflicts: [],
  leveledBlocks: [{ task_code: "A1010", original_start: "2026-01-05", leveled_start: "2026-01-07", delay_days: 2 }],
};

describe("SchedulingLevelingModal", () => {
  let mounted;
  beforeEach(() => { global.fetch = vi.fn(); });
  afterEach(() => {
    if (mounted) unmount(mounted);
    mounted = null;
    vi.restoreAllMocks();
  });

  it("loads a preview and shows the activities that would move, labeled from the board's own blocks", async () => {
    global.fetch.mockReturnValueOnce(jsonResponse(PREVIEW));
    mounted = mount(<SchedulingLevelingModal projectId="p1" blocks={BLOCKS} onClose={() => {}} />);
    await flush();
    expect(global.fetch).toHaveBeenCalledWith("/api/forge/scheduling/p1/level-resources?allowExtension=false");
    expect(mounted.container.textContent).toContain("A1010 Framing");
    expect(mounted.container.textContent).toContain("2026-01-07");
  });

  it("shows unresolved conflicts when present", async () => {
    global.fetch.mockReturnValueOnce(jsonResponse({
      success: true, projectFinishExtensionDays: 0, leveledBlocks: [],
      unresolvedConflicts: [{ task_code: "A1010", leveled_start: "2026-01-06", conflicts: [{ resource_id: "resource_1", date: "2026-01-06", allocated_units: 16, max_units_per_day: 8, over_by: 8 }] }],
    }));
    mounted = mount(<SchedulingLevelingModal projectId="p1" blocks={BLOCKS} onClose={() => {}} />);
    await flush();
    expect(mounted.container.textContent).toContain("Unresolved conflicts");
    expect(mounted.container.textContent).toContain("still over capacity on 2026-01-06");
  });

  it("re-fetches with allowExtension when the checkbox is toggled", async () => {
    global.fetch.mockReturnValue(jsonResponse(PREVIEW));
    mounted = mount(<SchedulingLevelingModal projectId="p1" blocks={BLOCKS} onClose={() => {}} />);
    await flush();

    const checkbox = mounted.container.querySelector('input[type="checkbox"]');
    await act(async () => { checkbox.click(); await flush(); });

    expect(global.fetch).toHaveBeenLastCalledWith("/api/forge/scheduling/p1/level-resources?allowExtension=true");
  });

  it("applies the leveling and shows a confirmation message", async () => {
    global.fetch
      .mockReturnValueOnce(jsonResponse(PREVIEW))
      .mockReturnValueOnce(jsonResponse({ success: true, appliedCount: 1 }));
    mounted = mount(<SchedulingLevelingModal projectId="p1" blocks={BLOCKS} onClose={() => {}} />);
    await flush();

    const applyButton = mounted.container.querySelector("[data-scheduling-leveling-apply]");
    await act(async () => { applyButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); await flush(); });

    expect(global.fetch).toHaveBeenCalledWith("/api/forge/scheduling/p1/level-resources/apply", expect.objectContaining({ method: "POST" }));
    expect(mounted.container.textContent).toContain("Applied");
    expect(mounted.container.textContent).toContain("1 activity");
  });

  it("disables Apply when there is nothing to level", async () => {
    global.fetch.mockReturnValueOnce(jsonResponse({ success: true, projectFinishExtensionDays: 0, leveledBlocks: [], unresolvedConflicts: [] }));
    mounted = mount(<SchedulingLevelingModal projectId="p1" blocks={BLOCKS} onClose={() => {}} />);
    await flush();
    expect(mounted.container.querySelector("[data-scheduling-leveling-apply]").disabled).toBe(true);
  });
});
