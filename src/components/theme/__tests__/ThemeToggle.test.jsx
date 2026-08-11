// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import ThemeProvider from "@/components/theme/ThemeProvider";
import ThemeToggle from "@/components/theme/ThemeToggle";

function mockMatchMedia(matches) {
  window.matchMedia = () => ({
    matches,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
}

function mount(children) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<ThemeProvider>{children}</ThemeProvider>);
  });

  return { container, root };
}

function unmount({ container, root }) {
  act(() => {
    root.unmount();
  });
  container.remove();
}

function trigger(container) {
  return container.querySelector('button[aria-haspopup="menu"]');
}

function menuItems(container) {
  return Array.from(container.querySelectorAll('[role="menuitemradio"]'));
}

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
  document.documentElement.style.colorScheme = "";
});

describe("ThemeToggle trigger button", () => {
  it("is a single compact button, not a permanently visible group of options", () => {
    mockMatchMedia(false);
    const mounted = mount(<ThemeToggle />);

    expect(mounted.container.querySelectorAll("button")).toHaveLength(1);
    expect(menuItems(mounted.container)).toHaveLength(0);

    unmount(mounted);
  });

  it("labels the trigger with the active preference and marks the menu closed", () => {
    mockMatchMedia(false);
    const mounted = mount(<ThemeToggle />);

    const button = trigger(mounted.container);
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.getAttribute("aria-label")).toBe("Theme: System. Open theme menu");

    unmount(mounted);
  });
});

describe("ThemeToggle menu", () => {
  it("opens a menu of Light/Dark/System on click, with the active one checked", () => {
    mockMatchMedia(false);
    const mounted = mount(<ThemeToggle />);

    act(() => {
      trigger(mounted.container).click();
    });

    expect(trigger(mounted.container).getAttribute("aria-expanded")).toBe("true");

    const items = menuItems(mounted.container);
    expect(items.map((item) => item.textContent)).toEqual([
      "Light",
      "Dark",
      "System",
    ]);

    const checked = items.filter(
      (item) => item.getAttribute("aria-checked") === "true",
    );
    expect(checked).toHaveLength(1);
    expect(checked[0].textContent).toBe("System");

    unmount(mounted);
  });

  it("switches the preference, updates the trigger label, and closes the menu on selection", () => {
    mockMatchMedia(false);
    const mounted = mount(<ThemeToggle />);

    act(() => {
      trigger(mounted.container).click();
    });

    const darkOption = menuItems(mounted.container).find(
      (item) => item.textContent === "Dark",
    );

    act(() => {
      darkOption.click();
    });

    expect(trigger(mounted.container).getAttribute("aria-label")).toBe(
      "Theme: Dark. Open theme menu",
    );
    expect(trigger(mounted.container).getAttribute("aria-expanded")).toBe("false");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    unmount(mounted);
  });

  it("closes when clicking outside the control", () => {
    mockMatchMedia(false);
    const mounted = mount(
      <div>
        <div data-testid="outside">outside</div>
        <ThemeToggle />
      </div>,
    );

    act(() => {
      trigger(mounted.container).click();
    });
    expect(trigger(mounted.container).getAttribute("aria-expanded")).toBe("true");

    act(() => {
      mounted.container
        .querySelector('[data-testid="outside"]')
        .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    expect(trigger(mounted.container).getAttribute("aria-expanded")).toBe("false");

    unmount(mounted);
  });
});

describe("ThemeToggle compact icon-only mode", () => {
  it("keeps an accessible label even without a visible text label", () => {
    mockMatchMedia(false);
    const mounted = mount(<ThemeToggle compact />);

    const button = trigger(mounted.container);
    expect(button.textContent.trim()).toBe("");
    expect(button.getAttribute("aria-label")).toBe("Theme: System. Open theme menu");
    expect(button.getAttribute("title")).toBe("Theme: System");

    unmount(mounted);
  });
});
