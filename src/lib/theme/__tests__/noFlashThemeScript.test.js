// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { THEME_STORAGE_KEY } from "@/lib/theme/constants";
import { buildNoFlashThemeScript } from "@/lib/theme/noFlashThemeScript";

function mockMatchMedia(matches) {
  window.matchMedia = () => ({ matches });
}

function runNoFlashScript() {
  // Mirrors what the inline <script> in the document head does before
  // React ever mounts: synchronously mutate document.documentElement.
  Function(buildNoFlashThemeScript())();
}

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
  document.documentElement.style.colorScheme = "";
});

describe("no-flash theme script", () => {
  it("embeds the shared storage key so it reads the same preference the app writes", () => {
    expect(buildNoFlashThemeScript()).toContain(THEME_STORAGE_KEY);
  });

  it("applies dark before any React code runs when the system prefers dark and nothing is stored", () => {
    mockMatchMedia(true);
    runNoFlashScript();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("stays light when the system prefers light and nothing is stored", () => {
    mockMatchMedia(false);
    runNoFlashScript();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("honors an explicit stored 'dark' preference over a light system preference", () => {
    mockMatchMedia(false);
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    runNoFlashScript();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("honors an explicit stored 'light' preference over a dark system preference", () => {
    mockMatchMedia(true);
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    runNoFlashScript();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("falls back to the system preference for a stored 'system' value", () => {
    mockMatchMedia(true);
    window.localStorage.setItem(THEME_STORAGE_KEY, "system");
    runNoFlashScript();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("never throws, even if storage access is blocked", () => {
    mockMatchMedia(true);
    const originalGetItem = window.localStorage.getItem;
    window.localStorage.getItem = () => {
      throw new Error("storage blocked");
    };

    expect(() => runNoFlashScript()).not.toThrow();

    window.localStorage.getItem = originalGetItem;
  });
});
