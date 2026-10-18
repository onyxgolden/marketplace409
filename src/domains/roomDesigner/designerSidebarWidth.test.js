// @vitest-environment jsdom

// D647-004: the tool-palette width persists per signed-in user, restores
// clamped, resets cleanly, and never exceeds half the viewport — including
// after the viewport shrinks.

import { beforeEach, describe, expect, it } from "vitest";
import {
  SIDEBAR_MIN_PX,
  clampSidebarWidth,
  readSidebarWidth,
  sidebarWidthKey,
  writeSidebarWidth,
} from "./designerSidebarWidth";

const LEGACY_KEY = "forge-designer-sidebar-width";

beforeEach(() => {
  window.localStorage.clear();
});

describe("designerSidebarWidth — keying", () => {
  it("keys the preference by user id", () => {
    expect(sidebarWidthKey("user-123")).toBe("forge-designer-sidebar-width:user-123");
    expect(sidebarWidthKey("user-456")).toBe("forge-designer-sidebar-width:user-456");
    expect(sidebarWidthKey("user-123")).not.toBe(sidebarWidthKey("user-456"));
  });

  it("falls back to a shared anonymous key for missing identities", () => {
    expect(sidebarWidthKey(null)).toBe("forge-designer-sidebar-width:anonymous");
    expect(sidebarWidthKey(undefined)).toBe("forge-designer-sidebar-width:anonymous");
    expect(sidebarWidthKey("   ")).toBe("forge-designer-sidebar-width:anonymous");
  });

  it("separates users sharing one browser", () => {
    writeSidebarWidth("alice", 300);
    writeSidebarWidth("bob", 420);
    expect(readSidebarWidth("alice")).toBe(300);
    expect(readSidebarWidth("bob")).toBe(420);
    // Writing for one user never touches the other's key.
    writeSidebarWidth("alice", 260);
    expect(readSidebarWidth("bob")).toBe(420);
  });
});

describe("designerSidebarWidth — clamping", () => {
  it("enforces the readable minimum", () => {
    expect(clampSidebarWidth(50, 2000)).toBe(SIDEBAR_MIN_PX);
    expect(clampSidebarWidth(-100, 2000)).toBe(SIDEBAR_MIN_PX);
  });

  it("enforces half the viewport as the live maximum", () => {
    expect(clampSidebarWidth(900, 1200)).toBe(600);
    expect(clampSidebarWidth(400, 1200)).toBe(400);
  });

  it("a fixed width is re-clamped after the viewport shrinks", () => {
    // Stored at 600px on a 1600px viewport; the tablet rotates to 800px.
    expect(clampSidebarWidth(600, 800)).toBe(400);
    // Degenerate tiny viewport: min still wins over max.
    expect(clampSidebarWidth(600, 300)).toBe(SIDEBAR_MIN_PX);
  });

  it("rejects non-numeric widths", () => {
    expect(clampSidebarWidth(NaN, 1200)).toBeNull();
    expect(clampSidebarWidth("wide", 1200)).toBeNull();
  });
});

describe("designerSidebarWidth — restore / reset", () => {
  it("restores a stored width, clamped to the current viewport", () => {
    writeSidebarWidth("u1", 900);
    expect(readSidebarWidth("u1", 1200)).toBe(600);
    expect(readSidebarWidth("u1", 2000)).toBe(900);
  });

  it("corrupt storage restores to null (the default width stands)", () => {
    window.localStorage.setItem(sidebarWidthKey("u1"), "not-a-number");
    expect(readSidebarWidth("u1")).toBeNull();
    window.localStorage.setItem(sidebarWidthKey("u1"), "{bad json");
    expect(readSidebarWidth("u1")).toBeNull();
  });

  it("absent storage restores to null", () => {
    expect(readSidebarWidth("nobody")).toBeNull();
  });

  it("reset removes the stored value", () => {
    writeSidebarWidth("u1", 320);
    expect(readSidebarWidth("u1")).toBe(320);
    writeSidebarWidth("u1", null);
    expect(readSidebarWidth("u1")).toBeNull();
    expect(window.localStorage.getItem(sidebarWidthKey("u1"))).toBeNull();
  });

  it("migrates the legacy global key once for existing users", () => {
    window.localStorage.setItem(LEGACY_KEY, "350");
    expect(readSidebarWidth("u1")).toBe(350);
    // Writes go to the per-user key from then on.
    writeSidebarWidth("u1", 380);
    expect(window.localStorage.getItem(sidebarWidthKey("u1"))).toBe("380");
  });

  it("a corrupt legacy key does not break restore", () => {
    window.localStorage.setItem(LEGACY_KEY, "garbage");
    expect(readSidebarWidth("u1")).toBeNull();
  });
});
