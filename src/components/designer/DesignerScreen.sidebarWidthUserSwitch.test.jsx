// @vitest-environment jsdom

// D647-004 (fix round 3): the user-switch write race. The sidebar width and
// the identity it was loaded for are ONE state value, so when the screen
// rerenders from user A to user B the persist effect must never call
// writeSidebarWidth for B with A's width — not even transiently. (The old
// ref-based guard let the write through in the same effect flush and only
// corrected it on the next flush, so a final-value assertion cannot catch
// the race; this test records every writeSidebarWidth call instead.) This
// renders the real DesignerScreen, not the pure helpers.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import DesignerScreen from "./DesignerScreen";
import {
  writeSidebarWidth,
  sidebarWidthKey,
} from "@/domains/roomDesigner/designerSidebarWidth";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/domains/roomDesigner/designerSidebarWidth", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    writeSidebarWidth: vi.fn((userId, px) => actual.writeSidebarWidth(userId, px)),
  };
});

const PROJECT_ID = "sidebar-width-race-test";

describe("DesignerScreen sidebar width user-switch race (D647-004)", () => {
  let container;
  let root;

  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(writeSidebarWidth).mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    // The screen loads the project over fetch on mount; a null design opens
    // an empty project (ensureHomeProject leniency).
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ project: { name: "Test", design: null } }),
      }))
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function seedWidths(a, b) {
    window.localStorage.setItem(sidebarWidthKey("userA"), String(a));
    window.localStorage.setItem(sidebarWidthKey("userB"), String(b));
  }

  function renderScreen(userId) {
    act(() => {
      root.render(<DesignerScreen projectId={PROJECT_ID} userId={userId} />);
    });
  }

  async function flushAsync() {
    await act(async () => {
      await Promise.resolve();
    });
  }

  function writesFor(userId, value) {
    return vi
      .mocked(writeSidebarWidth)
      .mock.calls.filter(([u, v]) => u === userId && (value === undefined || v === value));
  }

  it("never writes user A's width under user B's key during a user switch", async () => {
    seedWidths(300, 400);
    renderScreen("userA");
    await flushAsync();
    vi.mocked(writeSidebarWidth).mockClear(); // ignore mount writes; the switch is the test

    renderScreen("userB");
    await flushAsync();

    // The race: the old code wrote ("userB", 300) here before the restore
    // for B rendered. No call may ever pair B with A's width.
    expect(writesFor("userB", 300)).toEqual([]);
    expect(writesFor("userB", null)).toEqual([]);
    // Final stored values are intact for both users.
    expect(window.localStorage.getItem(sidebarWidthKey("userA"))).toBe("300");
    expect(window.localStorage.getItem(sidebarWidthKey("userB"))).toBe("400");
  });

  it("writes only B's own restored width under B's key after the switch", async () => {
    seedWidths(300, 400);
    renderScreen("userA");
    await flushAsync();
    vi.mocked(writeSidebarWidth).mockClear();

    renderScreen("userB");
    await flushAsync();

    for (const [u, v] of vi.mocked(writeSidebarWidth).mock.calls) {
      if (u === "userB") expect(v).toBe(400);
    }
    expect(window.localStorage.getItem(sidebarWidthKey("userB"))).toBe("400");
  });
});
