// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { THEME_STORAGE_KEY } from "@/lib/theme/constants";
import {
  applyEffectiveTheme,
  getSystemTheme,
  readStoredThemePreference,
  resolveEffectiveTheme,
  writeStoredThemePreference,
} from "@/lib/theme/resolveTheme";

function mockMatchMedia(matches) {
  window.matchMedia = (query) => ({
    matches,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
}

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
  document.documentElement.style.colorScheme = "";
});

describe("getSystemTheme", () => {
  it("returns dark when the OS prefers dark", () => {
    mockMatchMedia(true);
    expect(getSystemTheme()).toBe("dark");
  });

  it("returns light when the OS prefers light", () => {
    mockMatchMedia(false);
    expect(getSystemTheme()).toBe("light");
  });
});

describe("resolveEffectiveTheme", () => {
  it("passes through explicit light and dark preferences", () => {
    expect(resolveEffectiveTheme("light")).toBe("light");
    expect(resolveEffectiveTheme("dark")).toBe("dark");
  });

  it("defers to the system preference for 'system'", () => {
    mockMatchMedia(true);
    expect(resolveEffectiveTheme("system")).toBe("dark");

    mockMatchMedia(false);
    expect(resolveEffectiveTheme("system")).toBe("light");
  });
});

describe("stored theme preference", () => {
  it("returns null when nothing has been stored", () => {
    expect(readStoredThemePreference()).toBeNull();
  });

  it("restores a previously stored valid preference", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    expect(readStoredThemePreference()).toBe("dark");
  });

  it("ignores a corrupted or unrecognized stored value", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    expect(readStoredThemePreference()).toBeNull();
  });

  it("persists a preference for later restoration", () => {
    writeStoredThemePreference("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });
});

describe("applyEffectiveTheme", () => {
  it("adds the dark class and sets color-scheme for dark", () => {
    applyEffectiveTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("removes the dark class and sets color-scheme for light", () => {
    document.documentElement.classList.add("dark");
    applyEffectiveTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");
  });
});
