// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { THEME_STORAGE_KEY } from "@/lib/theme/constants";
import ThemeProvider, { useTheme } from "@/components/theme/ThemeProvider";

function createMatchMediaMock(initialMatches) {
  let matches = initialMatches;
  const listeners = new Set();

  window.matchMedia = (query) => ({
    get matches() {
      return matches;
    },
    media: query,
    addEventListener: (event, handler) => {
      if (event === "change") listeners.add(handler);
    },
    removeEventListener: (event, handler) => {
      if (event === "change") listeners.delete(handler);
    },
  });

  return {
    setMatches(next) {
      matches = next;
      act(() => {
        listeners.forEach((handler) => handler());
      });
    },
    listenerCount: () => listeners.size,
  };
}

function ThemeConsumer() {
  const { preference, resolvedTheme, setThemePreference } = useTheme();

  return (
    <div>
      <span data-testid="preference">{preference}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <button onClick={() => setThemePreference("light")}>Set light</button>
      <button onClick={() => setThemePreference("dark")}>Set dark</button>
      <button onClick={() => setThemePreference("system")}>Set system</button>
    </div>
  );
}

function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>,
    );
  });

  return { container, root };
}

function unmount({ container, root }) {
  act(() => {
    root.unmount();
  });
  container.remove();
}

function clickButton(container, text) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === text,
  );
  act(() => {
    button.click();
  });
}

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
  document.documentElement.style.colorScheme = "";
});

describe("ThemeProvider default/system behavior", () => {
  it("resolves to the OS preference when nothing is stored", () => {
    createMatchMediaMock(true);
    const mounted = mount();

    expect(mounted.container.querySelector('[data-testid="resolved"]').textContent).toBe(
      "dark",
    );
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    unmount(mounted);
  });

  it("resolves to light when the OS prefers light and nothing is stored", () => {
    createMatchMediaMock(false);
    const mounted = mount();

    expect(mounted.container.querySelector('[data-testid="resolved"]').textContent).toBe(
      "light",
    );
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    unmount(mounted);
  });
});

describe("ThemeProvider stored preference restoration", () => {
  it("restores an explicit stored preference on mount", () => {
    createMatchMediaMock(false);
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");

    const mounted = mount();

    expect(mounted.container.querySelector('[data-testid="preference"]').textContent).toBe(
      "dark",
    );
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    unmount(mounted);
  });
});

describe("ThemeProvider switching and persistence", () => {
  it("switches to dark, light, and system and persists each choice", () => {
    createMatchMediaMock(false);
    const mounted = mount();

    clickButton(mounted.container, "Set dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    clickButton(mounted.container, "Set light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");

    clickButton(mounted.container, "Set system");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
    expect(
      mounted.container.querySelector('[data-testid="resolved"]').textContent,
    ).toBe("light");

    unmount(mounted);
  });
});

describe("ThemeProvider system preference changes", () => {
  it("reacts live to an OS preference change while 'system' is selected", () => {
    const media = createMatchMediaMock(false);
    const mounted = mount();

    clickButton(mounted.container, "Set system");
    expect(
      mounted.container.querySelector('[data-testid="resolved"]').textContent,
    ).toBe("light");

    media.setMatches(true);

    expect(
      mounted.container.querySelector('[data-testid="resolved"]').textContent,
    ).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    unmount(mounted);
  });

  it("ignores OS changes while a manual preference is selected", () => {
    const media = createMatchMediaMock(false);
    const mounted = mount();

    clickButton(mounted.container, "Set dark");
    expect(
      mounted.container.querySelector('[data-testid="resolved"]').textContent,
    ).toBe("dark");

    media.setMatches(true);

    expect(
      mounted.container.querySelector('[data-testid="resolved"]').textContent,
    ).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    unmount(mounted);
  });
});
