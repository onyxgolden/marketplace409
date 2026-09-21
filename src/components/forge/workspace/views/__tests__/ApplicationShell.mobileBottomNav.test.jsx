// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import ApplicationShell from "../../ApplicationShell.jsx";

const functions = [
  { id: "overview", label: "Overview" },
  { id: "transactions", label: "Transactions" },
  { id: "properties", label: "Properties" },
  { id: "assets", label: "Assets" },
  { id: "investments", label: "Investments" },
  { id: "operations", label: "Operations" },
  { id: "tools", label: "Tools" },
  { id: "import", label: "Import" },
];

function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(ui); });
  return { container, root };
}
async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}
function click(element) {
  act(() => { element.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}

function mockFetch({ initialHidden = [] } = {}) {
  const fetchMock = vi.fn((url, options) => {
    if (!options) return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, hiddenItemIds: initialHidden }) });
    return Promise.reject(new Error(`unexpected fetch: ${url} ${JSON.stringify(options)}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderShell(props = {}) {
  return mount(
    <ApplicationShell
      applicationName="Financial"
      functions={functions}
      activeFunctionId="overview"
      activeSurface={<div />}
      sidebarKey="financial"
      onFunctionChange={() => {}}
      {...props}
    />,
  );
}

describe("ApplicationShell mobileBottomNav", () => {
  let mounted;
  afterEach(() => {
    if (mounted) { act(() => { mounted.root.unmount(); }); mounted.container.remove(); mounted = null; }
    vi.unstubAllGlobals();
  });

  it("renders a mobile-only fixed bottom nav and hides the chip row on mobile when enabled", () => {
    mockFetch();
    mounted = renderShell({ mobileBottomNav: true });
    const bottomNav = mounted.container.querySelector("[data-mobile-bottom-nav]");
    expect(bottomNav).not.toBeNull();
    expect(bottomNav.className).toContain("fixed");
    expect(bottomNav.className).toContain("bottom-0");
    expect(bottomNav.className).toContain("lg:hidden");

    const chipNav = mounted.container.querySelector('nav[aria-label="Financial functions"]:not([data-mobile-bottom-nav])');
    expect(chipNav.className).toContain("hidden");
    expect(chipNav.className).toContain("lg:flex");
  });

  it("renders no bottom nav and keeps the scrolling chip row when the prop is omitted (other apps unchanged)", () => {
    mockFetch();
    mounted = renderShell();
    expect(mounted.container.querySelector("[data-mobile-bottom-nav]")).toBeNull();

    const chipNav = mounted.container.querySelector('nav[aria-label="Financial functions"]');
    expect(chipNav.className).toContain("flex");
    expect(chipNav.className).not.toContain("lg:hidden");
  });

  it("shows the four primary tabs plus More, with the active tab marked current", () => {
    mockFetch();
    mounted = renderShell({ mobileBottomNav: true, activeFunctionId: "transactions" });
    const bottomNav = mounted.container.querySelector("[data-mobile-bottom-nav]");
    const labels = Array.from(bottomNav.querySelectorAll("button")).map((button) => button.textContent);
    expect(labels).toEqual(["Overview", "Transactions", "Properties", "Assets", "More"]);

    const activeTab = Array.from(bottomNav.querySelectorAll("button")).find((button) => button.textContent === "Transactions");
    expect(activeTab.getAttribute("aria-current")).toBe("page");
    const moreTab = Array.from(bottomNav.querySelectorAll("button")).find((button) => button.textContent === "More");
    expect(moreTab.hasAttribute("aria-current")).toBe(false);
  });

  it("marks the More tab active when the active function lives behind it", () => {
    mockFetch();
    mounted = renderShell({ mobileBottomNav: true, activeFunctionId: "investments" });
    const bottomNav = mounted.container.querySelector("[data-mobile-bottom-nav]");
    const moreTab = Array.from(bottomNav.querySelectorAll("button")).find((button) => button.textContent === "More");
    expect(moreTab.getAttribute("aria-current")).toBe("page");
  });

  it("gives the content bottom clearance for the fixed nav (safe-area aware) on mobile only", () => {
    mockFetch();
    mounted = renderShell({ mobileBottomNav: true });
    const main = mounted.container.querySelector("main");
    expect(main.className).toContain("pb-[calc(6.5rem+env(safe-area-inset-bottom))]");
    expect(main.className).toContain("lg:pb-8");
  });

  it("opens the More sheet listing the remaining functions, navigates on tap, and closes", () => {
    mockFetch();
    const onFunctionChange = vi.fn();
    mounted = renderShell({ mobileBottomNav: true, onFunctionChange });

    expect(mounted.container.querySelector("[data-mobile-more-sheet]")).toBeNull();
    const moreTab = Array.from(mounted.container.querySelectorAll("[data-mobile-bottom-nav] button")).find((button) => button.textContent === "More");
    click(moreTab);

    const sheet = mounted.container.querySelector("[data-mobile-more-sheet]");
    expect(sheet).not.toBeNull();
    const sheetLabels = Array.from(sheet.querySelectorAll("button")).filter((button) => !button.getAttribute("aria-label")?.startsWith("Close")).map((button) => button.textContent);
    expect(sheetLabels).toContain("Investments");
    expect(sheetLabels).toContain("Operations");
    expect(sheetLabels).toContain("Tools");
    expect(sheetLabels).toContain("Import");

    const toolsButton = Array.from(sheet.querySelectorAll("button")).find((button) => button.textContent === "Tools");
    click(toolsButton);
    expect(onFunctionChange).toHaveBeenCalledWith("tools");
    expect(mounted.container.querySelector("[data-mobile-more-sheet]")).toBeNull();
  });

  it("closes the More sheet from the backdrop", () => {
    mockFetch();
    mounted = renderShell({ mobileBottomNav: true });
    const moreTab = Array.from(mounted.container.querySelectorAll("[data-mobile-bottom-nav] button")).find((button) => button.textContent === "More");
    click(moreTab);
    expect(mounted.container.querySelector("[data-mobile-more-sheet]")).not.toBeNull();

    const backdrop = mounted.container.querySelector('[data-mobile-more-sheet] button[aria-label="Close more functions"]');
    click(backdrop);
    expect(mounted.container.querySelector("[data-mobile-more-sheet]")).toBeNull();
  });

  it("moves focus into the More sheet on open and returns it to the More trigger on close", () => {
    mockFetch();
    mounted = renderShell({ mobileBottomNav: true });
    const moreTab = Array.from(mounted.container.querySelectorAll("[data-mobile-bottom-nav] button")).find((button) => button.textContent === "More");
    click(moreTab);

    const sheet = mounted.container.querySelector("[data-mobile-more-sheet]");
    const sheetClose = sheet.querySelector('button[aria-label="Close more functions"]:not(.absolute)');
    expect(sheetClose).not.toBeNull();
    expect(document.activeElement).toBe(sheetClose);

    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(mounted.container.querySelector("[data-mobile-more-sheet]")).toBeNull();
    expect(document.activeElement).toBe(moreTab);
  });

  it("traps Tab inside the More sheet while open", () => {
    mockFetch();
    mounted = renderShell({ mobileBottomNav: true });
    const moreTab = Array.from(mounted.container.querySelectorAll("[data-mobile-bottom-nav] button")).find((button) => button.textContent === "More");
    click(moreTab);

    const sheet = mounted.container.querySelector("[data-mobile-more-sheet]");
    const focusables = Array.from(
      sheet.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    expect(focusables.length).toBeGreaterThan(1);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    last.focus();
    expect(document.activeElement).toBe(last);
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })); });
    expect(document.activeElement).toBe(first);
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true })); });
    expect(document.activeElement).toBe(last);
  });

  it("keeps the customize control inside the More sheet on mobile", () => {
    mockFetch();
    mounted = renderShell({ mobileBottomNav: true });
    const moreTab = Array.from(mounted.container.querySelectorAll("[data-mobile-bottom-nav] button")).find((button) => button.textContent === "More");
    click(moreTab);
    const sheet = mounted.container.querySelector("[data-mobile-more-sheet]");
    expect(sheet.textContent).toContain("Customize navigation");
    // Inline mode lives inside the sheet's own dialog: no nested dialog role, no close X.
    const customizeGroup = sheet.querySelector('[role="group"]');
    expect(customizeGroup).not.toBeNull();
    expect(customizeGroup.getAttribute("aria-label")).toBe("Customize navigation");
    expect(sheet.querySelector('[role="group"] [role="dialog"]')).toBeNull();
    expect(customizeGroup.querySelector('button[aria-label="Close customize sidebar"]')).toBeNull();
  });

  it("honors hide/show preferences in the bottom nav and the More sheet", async () => {
    mockFetch({ initialHidden: ["assets", "tools"] });
    mounted = renderShell({ mobileBottomNav: true });
    await flush();

    const bottomLabels = Array.from(mounted.container.querySelectorAll("[data-mobile-bottom-nav] button")).map((button) => button.textContent);
    expect(bottomLabels).toEqual(["Overview", "Transactions", "Properties", "More"]);

    const moreTab = Array.from(mounted.container.querySelectorAll("[data-mobile-bottom-nav] button")).find((button) => button.textContent === "More");
    click(moreTab);
    const sheet = mounted.container.querySelector("[data-mobile-more-sheet]");
    const sheetLabels = Array.from(sheet.querySelectorAll("button")).map((button) => button.textContent);
    expect(sheetLabels).not.toContain("Tools");
    expect(sheetLabels).toContain("Investments");
  });
});
