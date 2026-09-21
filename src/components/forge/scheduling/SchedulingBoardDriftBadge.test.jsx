// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The persistence hook is the only scheduling hook SchedulingBoard reads
// saveStatus from. Mock it so the drift-badge wiring can be driven without a
// real project fetch: the board state is a real default board, and saveStatus
// is controllable per test via hookState.
const hookState = { saveStatus: "Idle" };
vi.mock("./usePersistedBoard", async () => {
  const { defaultBoardState } = await import("./schedulingBoardState");
  return {
    usePersistedBoard: () => ({
      board: defaultBoardState("p1", "capital"),
      setBoard: () => {},
      isOwner: true,
      loadError: null,
      saveStatus: hookState.saveStatus,
      conflict: false,
      conflictMessage: "",
      reload: () => {},
    }),
  };
});

import SchedulingBoard from "./SchedulingBoard";

function json(body, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) });
}
const driftBody = (driftedCount, majorCount) => ({ success: true, summary: { driftedCount, majorCount } });

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
function badgeTotal(container) {
  const badge = container.querySelector('[aria-label$="drifted activities"]');
  return badge ? badge.getAttribute("aria-label") : null;
}
const driftFetchCount = () => global.fetch.mock.calls.filter(([url]) => String(url).endsWith("/drift")).length;

describe("SchedulingBoard — drift badge freshness", () => {
  let mounted;
  let driftResolvers;

  beforeEach(() => {
    driftResolvers = [];
    hookState.saveStatus = "Idle";
    global.fetch = vi.fn((url, init) => {
      if (url === "/api/forge/scheduling/resources") return json({ success: true, resources: [] });
      if (url === "/api/forge/scheduling/cost-accounts") return json({ success: true, costAccounts: [] });
      if (typeof url === "string" && url.endsWith("/drift")) {
        return new Promise((resolve) => { driftResolvers.push({ url, resolve }); });
      }
      if (typeof url === "string" && url.endsWith("/baselines")) {
        if (init?.method === "POST") return json({ success: true, baselineId: "baseline_new" });
        return json({ success: true, baselines: [] });
      }
      return new Promise(() => {}); // everything else never resolves
    });
  });

  afterEach(() => {
    if (mounted) unmount(mounted);
    mounted = null;
    vi.restoreAllMocks();
  });

  it("loads the drift badge for the project on mount", async () => {
    mounted = mount(<SchedulingBoard projectId="p1" />);
    await flush();
    expect(driftResolvers).toHaveLength(1);
    expect(driftResolvers[0].url).toBe("/api/forge/scheduling/p1/drift");
    await act(async () => { driftResolvers[0].resolve(json(driftBody(2, 1))); });
    expect(badgeTotal(mounted.container)).toBe("2 drifted activities");
    // Major drift renders the red badge variant.
    expect(mounted.container.querySelector('[aria-label="2 drifted activities"]').className).toContain("bg-red-600");
  });

  it("clears the badge immediately on project switch and rejects the stale project's late response", async () => {
    mounted = mount(<SchedulingBoard projectId="p1" />);
    await flush();
    expect(driftResolvers).toHaveLength(1); // p1's request in flight

    act(() => { mounted.root.render(<SchedulingBoard projectId="p2" />); });
    // The old project's count must never show while the new project's badge loads.
    expect(badgeTotal(mounted.container)).toBeNull();
    expect(driftResolvers).toHaveLength(2);
    expect(driftResolvers[1].url).toBe("/api/forge/scheduling/p2/drift");

    // p1's response arrives late -- it must not overwrite the current badge.
    await act(async () => { driftResolvers[0].resolve(json(driftBody(2, 1))); });
    expect(badgeTotal(mounted.container)).toBeNull();

    // p2's response arrives -- the badge now shows the current project's counts.
    await act(async () => { driftResolvers[1].resolve(json(driftBody(5, 0))); });
    expect(badgeTotal(mounted.container)).toBe("5 drifted activities");
  });

  it("refreshes the badge with the new report after the schedule save persists", async () => {
    mounted = mount(<SchedulingBoard projectId="p1" />);
    await flush();
    await act(async () => { driftResolvers[0].resolve(json(driftBody(2, 1))); });
    expect(badgeTotal(mounted.container)).toBe("2 drifted activities");
    expect(driftFetchCount()).toBe(1);

    // The autosave flips to "Saved" -> the board re-queries the drift report.
    hookState.saveStatus = "Saved";
    act(() => { mounted.root.render(<SchedulingBoard projectId="p1" />); });
    expect(driftFetchCount()).toBe(2);

    // The fresh report replaces the badge; the older response no longer matters.
    await act(async () => { driftResolvers[1].resolve(json(driftBody(0, 0))); });
    expect(badgeTotal(mounted.container)).toBeNull();
  });

  it("refreshes the badge after a baseline is captured through the inspector", async () => {
    mounted = mount(<SchedulingBoard projectId="p1" />);
    await flush();
    await act(async () => { driftResolvers[0].resolve(json(driftBody(2, 1))); });
    expect(badgeTotal(mounted.container)).toBe("2 drifted activities");

    const openButton = [...mounted.container.querySelectorAll("button")]
      .find((button) => button.title === "Open Baselines in the inspector");
    await act(async () => { openButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    const inspector = mounted.container.querySelector("[data-scheduling-inspector]");
    expect(inspector).not.toBeNull();

    const input = inspector.querySelector("input");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    await act(async () => { setter.call(input, "Replan"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    const captureButton = [...inspector.querySelectorAll("button")].find((button) => button.textContent === "Capture baseline");
    await act(async () => {
      captureButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await flush();
    });
    expect(inspector.textContent).toContain("Baseline captured.");
    // The successful capture re-queries the drift report and swaps in the new badge.
    expect(driftFetchCount()).toBe(2);
    await act(async () => { driftResolvers[1].resolve(json(driftBody(4, 2))); });
    expect(badgeTotal(mounted.container)).toBe("4 drifted activities");
  });
});
