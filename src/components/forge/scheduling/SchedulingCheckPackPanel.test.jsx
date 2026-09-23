// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import React from "react";
import { describe, expect, it } from "vitest";
import { SchedulingChecksPanel } from "./SchedulingCheckPackPanel";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
function click(el) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

const BOARD = {
  blocks: [
    { id: "b1", taskCode: "A1020", label: "Framing", milestone: false },
    { id: "b2", taskCode: "A1030", label: "Plumbing rough-in", milestone: false },
    { id: "b3", taskCode: "A1040", label: "Electrical rough-in", milestone: false },
  ],
  dependencies: [
    { predecessorId: "b1", successorId: "b2" },
    { predecessorId: "b2", successorId: "b3" },
  ],
  cpm: {
    byTaskCode: {
      A1020: { earlyStart: "2026-09-01", earlyFinish: "2026-09-10", totalFloatDays: -2, percentComplete: 0, actualStart: null, actualFinish: null },
      A1030: { earlyStart: "2026-09-11", earlyFinish: "2026-09-18", totalFloatDays: 4, percentComplete: 0, actualStart: null, actualFinish: null },
      A1040: { earlyStart: "2026-09-19", earlyFinish: "2026-09-25", totalFloatDays: 4, percentComplete: 0, actualStart: null, actualFinish: null },
    },
  },
  wbs: { activities: [{ code: "A1020", wbsId: "w1" }, { code: "A1030", wbsId: "w1" }] },
};

const EMPTY_BOARD = { blocks: [], dependencies: [], cpm: { byTaskCode: {} }, wbs: { activities: [] } };

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

describe("SchedulingChecksPanel", () => {
  it("renders the six check buttons with an overall summary", () => {
    const mounted = mount(<SchedulingChecksPanel board={BOARD} onClose={() => {}} />);
    try {
      const buttons = mounted.container.querySelectorAll("[data-scheduling-check]");
      expect(buttons).toHaveLength(6);
      expect(mounted.container.querySelector("[data-scheduling-checks-summary").textContent).toContain("2 of 6 checks need attention.");
    } finally {
      unmount(mounted);
    }
  });

  it("defaults to the first check needing attention and renders its column preset", () => {
    const mounted = mount(<SchedulingChecksPanel board={BOARD} onClose={() => {}} />);
    try {
      // Uncoded comes before Negative Float in definition order and also needs attention.
      const summary = mounted.container.querySelector("[data-scheduling-checks-active-summary]");
      expect(summary.textContent).toBe("Uncoded — 1 activity requires attention");
      const headers = [...mounted.container.querySelectorAll("th")].map((th) => th.textContent);
      expect(headers).toEqual(["Activity ID", "Activity", "WBS", "Start", "Finish"]);
      const rows = mounted.container.querySelectorAll("[data-scheduling-check-row]");
      expect(rows).toHaveLength(1);
      expect(rows[0].textContent).toContain("A1040");
      expect(rows[0].textContent).toContain("Electrical rough-in");
    } finally {
      unmount(mounted);
    }
  });

  it("switches to another check and renders its own column preset", () => {
    const mounted = mount(<SchedulingChecksPanel board={BOARD} onClose={() => {}} />);
    try {
      click(mounted.container.querySelector('[data-scheduling-check="negative_float"]'));
      const summary = mounted.container.querySelector("[data-scheduling-checks-active-summary]");
      expect(summary.textContent).toBe("Negative Float — 1 activity requires attention");
      const headers = [...mounted.container.querySelectorAll("th")].map((th) => th.textContent);
      expect(headers).toEqual(["Activity ID", "Activity", "Start", "Finish", "Total float (d)"]);
      const rows = mounted.container.querySelectorAll("[data-scheduling-check-row]");
      expect(rows).toHaveLength(1);
      expect(rows[0].textContent).toContain("A1020");
    } finally {
      unmount(mounted);
    }
  });

  it("shows an all-clear state for a check with no flags", () => {
    const mounted = mount(<SchedulingChecksPanel board={BOARD} onClose={() => {}} />);
    try {
      click(mounted.container.querySelector('[data-scheduling-check="gapped_activities"]'));
      const summary = mounted.container.querySelector("[data-scheduling-checks-active-summary]");
      expect(summary.textContent).toBe("Gapped Activities — all clear");
      expect(mounted.container.querySelectorAll("[data-scheduling-check-row]")).toHaveLength(0);
    } finally {
      unmount(mounted);
    }
  });

  it("shows an empty-state message when the project has no activities", () => {
    const mounted = mount(<SchedulingChecksPanel board={EMPTY_BOARD} onClose={() => {}} />);
    try {
      expect(mounted.container.querySelector("[data-scheduling-checks-empty]")).not.toBeNull();
      expect(mounted.container.querySelectorAll("[data-scheduling-check]")).toHaveLength(0);
    } finally {
      unmount(mounted);
    }
  });

  it("never mutates the board: a deep-frozen fixture survives mounting and check switching", () => {
    // The component immutability contract: mounting the panel and selecting
    // checks is presentation state only. Any write to the board would throw
    // against the frozen fixture (strict-mode assignment) or show up in the
    // post-interaction snapshot.
    const frozenBoard = deepFreeze(JSON.parse(JSON.stringify(BOARD)));
    const snapshot = JSON.parse(JSON.stringify(frozenBoard));
    expect(() => {
      const mounted = mount(<SchedulingChecksPanel board={frozenBoard} onClose={() => {}} />);
      try {
        for (const checkId of ["broken_activities", "gapped_activities", "start_in_future", "finish_in_future", "uncoded", "negative_float"]) {
          click(mounted.container.querySelector(`[data-scheduling-check="${checkId}"]`));
        }
      } finally {
        unmount(mounted);
      }
    }).not.toThrow();
    expect(JSON.parse(JSON.stringify(frozenBoard))).toEqual(snapshot);
  });
});
