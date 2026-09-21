// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DriftAlertsPanel } from "./DriftAlertsPanel";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const REPORT = {
  success: true,
  hasBaseline: true,
  baselineName: "Baseline 1",
  asOf: "2026-09-20",
  thresholdDays: 2,
  drifted: [
    {
      taskCode: "A1020", label: "Framing", blockType: "task",
      baselineStart: "2026-01-12", baselineFinish: "2026-01-23",
      currentStart: "2026-01-12", currentFinish: "2026-01-28",
      startVarianceDays: 0, finishVarianceDays: 5, maxVarianceDays: 5,
      direction: "late", severity: "major",
      detail: "Start on schedule · Finish +5d",
    },
  ],
  summary: {
    driftedCount: 1, minorCount: 0, majorCount: 1,
    earlyCount: 0, lateCount: 1, mixedCount: 0,
    comparedCount: 2, completedExcludedCount: 1, noBaselineCount: 0,
    addedSinceBaselineCount: 0, removedSinceBaselineCount: 0,
    projectFinishVarianceDays: 5,
  },
};

const NO_BASELINE = { success: true, hasBaseline: false, drifted: [], summary: { driftedCount: 0 } };

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

describe("DriftAlertsPanel", () => {
  let fetchMock;
  let mounted;

  beforeEach(() => {
    fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(REPORT) }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    if (mounted) unmount(mounted);
    mounted = null;
    vi.unstubAllGlobals();
  });

  it("fetches the drift report on mount and renders drifted activities", async () => {
    mounted = mount(<DriftAlertsPanel projectId="p1" />);
    await flush();
    expect(fetchMock).toHaveBeenCalledWith("/api/forge/scheduling/p1/drift?thresholdDays=2");
    expect(mounted.container.textContent).toContain("A1020");
    expect(mounted.container.textContent).toContain("Framing");
    // Severity/direction chips render lowercase text with a CSS `uppercase`
    // class, so textContent sees the raw values.
    expect(mounted.container.textContent).toContain("major");
    expect(mounted.container.textContent).toContain("late");
    expect(mounted.container.textContent).toContain("2026-01-12 → 2026-01-23");
    expect(mounted.container.textContent).toContain("2026-01-12 → 2026-01-28");
    expect(mounted.container.textContent).toContain('1 drifted (1 major) vs "Baseline 1"');
  });

  it("explains the no-baseline state instead of an empty list", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(NO_BASELINE) });
    mounted = mount(<DriftAlertsPanel projectId="p1" />);
    await flush();
    expect(mounted.container.textContent).toContain("No baseline has been captured");
    expect(mounted.container.textContent).toContain("Baselines");
  });

  it("re-queries when the threshold changes", async () => {
    mounted = mount(<DriftAlertsPanel projectId="p1" />);
    await flush();
    const select = mounted.container.querySelector("#drift-threshold");
    expect(select).not.toBeNull();
    await act(async () => {
      select.value = "5";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/forge/scheduling/p1/drift?thresholdDays=5");
  });

  it("shows an error when the report cannot be computed", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: () => Promise.resolve({ error: "boom" }) });
    mounted = mount(<DriftAlertsPanel projectId="p1" />);
    await flush();
    expect(mounted.container.querySelector('[role="alert"]').textContent).toContain("boom");
  });

  it("ignores a stale threshold response that arrives after the newer one", async () => {
    const resolvers = [];
    fetchMock.mockImplementation(() => new Promise((resolve) => { resolvers.push(resolve); }));
    const reportFor = (threshold, count) => ({
      ok: true,
      json: () => Promise.resolve({
        ...REPORT,
        thresholdDays: threshold,
        summary: { ...REPORT.summary, driftedCount: count, majorCount: count },
      }),
    });
    mounted = mount(<DriftAlertsPanel projectId="p1" />);
    await act(async () => { await Promise.resolve(); });
    expect(resolvers).toHaveLength(1); // threshold=2 request in flight
    const select = mounted.container.querySelector("#drift-threshold");
    await act(async () => {
      select.value = "5";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(resolvers).toHaveLength(2); // threshold=5 request in flight
    // The newer (5d) response arrives first...
    await act(async () => { resolvers[1](reportFor(5, 9)); });
    expect(mounted.container.textContent).toContain("9 drifted");
    // ...then the stale 2d response arrives last and must not overwrite it.
    await act(async () => { resolvers[0](reportFor(2, 1)); });
    expect(mounted.container.textContent).toContain("9 drifted");
    expect(mounted.container.textContent).not.toContain("1 drifted (1 major)");
  });
});
