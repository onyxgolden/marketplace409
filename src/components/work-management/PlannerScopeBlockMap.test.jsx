// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// D3 dashboard: the Scope block map widget. Covers the brief's binding
// test-plan items at the route/component level: exact group/status
// links and clear transitions, exact active state (never claimed under
// extra narrowing), customization (grouping/pivot/title/threshold/hide/
// show/reset) persisted per owner+project in localStorage and isolated
// across keys, invalid stored values falling back safely, URL params
// overriding a saved preference, empty/one-group/many-group states, and
// non-colour status cues.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a>,
}));

// D3 fix round 1: the grouping/pivot controls write the canonical URL
// state when a scopeBy/scopeView override is active, via router.replace.
const navigationMocks = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigationMocks.replace }),
}));

import PlannerScopeBlockMap from "./PlannerScopeBlockMap.jsx";

const PKG = (overrides) => ({
  id: "wp_x", status: "draft", unit: null, area: null, system: null, workscope_code: null,
  responsible_party: null, ...overrides,
});

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function render(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<PlannerScopeBlockMap baseHref="/forge/work" {...props} />);
  });
  return { container, root };
}

function click(el) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function byText(container, tag, text) {
  return [...container.querySelectorAll(tag)].find((el) => el.textContent.trim() === text);
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
  navigationMocks.replace.mockClear();
});

afterEach(() => {
  document.body.innerHTML = "";
  window.localStorage.clear();
});

describe("PlannerScopeBlockMap", () => {
  it("shows an honest empty state for an empty project, never a synthetic zero tile", async () => {
    const { container } = render({ packages: [] });
    await flush();
    expect(container.textContent).toContain("No packages in this project yet");
    expect(container.querySelector('[data-testid="scope-block-treemap"]')).toBeNull();
  });

  it("defaults to Equipment type (system) grouping and treemap pivot", async () => {
    const { container } = render({ packages: [PKG({ system: "Pumps" })] });
    await flush();
    const groupByGroup = container.querySelector('[aria-label^="Group by"]');
    const activeBtn = [...groupByGroup.querySelectorAll("button")].find((b) => b.getAttribute("aria-pressed") === "true");
    expect(activeBtn.textContent).toBe("Equipment type");
    expect(container.querySelector('[data-testid="scope-block-treemap"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="scope-block-table"]')).toBeNull();
  });

  it("renders one group tile per present value, each a working link with an exact group filter", async () => {
    const packages = [
      PKG({ id: "wp_1", system: "Pumps", status: "in_progress" }),
      PKG({ id: "wp_2", system: "Valves", status: "draft" }),
    ];
    const { container } = render({ packages });
    await flush();
    const links = [...container.querySelectorAll('[data-testid="scope-block-treemap"] a')];
    const pumpsLink = links.find((a) => a.getAttribute("aria-label")?.startsWith("Pumps,"));
    expect(pumpsLink.getAttribute("href")).toBe("/forge/work?system=Pumps");
    const valvesLink = links.find((a) => a.getAttribute("aria-label")?.startsWith("Valves,"));
    expect(valvesLink.getAttribute("href")).toBe("/forge/work?system=Valves");
  });

  it("a status tile link carries both the group and the status; its label names group, status, and count (non-colour cue)", async () => {
    const packages = [PKG({ id: "wp_1", system: "Pumps", status: "in_progress" })];
    const { container } = render({ packages });
    await flush();
    const links = [...container.querySelectorAll('[data-testid="scope-block-treemap"] a')];
    const statusLink = links.find((a) => a.getAttribute("href") === "/forge/work?system=Pumps&status=in_progress");
    expect(statusLink).toBeTruthy();
    expect(statusLink.getAttribute("aria-label")).toContain("Pumps");
    expect(statusLink.getAttribute("aria-label")).toContain("in progress");
    expect(statusLink.getAttribute("aria-label")).toContain("1 package");
  });

  it("an active group tile's header click clears to the scope-only base; an active status tile's click clears only the status", async () => {
    const packages = [PKG({ id: "wp_1", system: "Pumps", status: "in_progress" })];
    const { container } = render({ packages, activeGroup: { dimension: "system", key: "Pumps" } });
    await flush();
    const groupLink = [...container.querySelectorAll('[data-testid="scope-block-treemap"] a')].find((a) => a.getAttribute("aria-label")?.startsWith("Pumps,"));
    expect(groupLink.getAttribute("aria-pressed")).toBe("true");
    expect(groupLink.getAttribute("href")).toBe("/forge/work");

    const { container: c2 } = render({ packages, activeGroup: { dimension: "system", key: "Pumps" }, activeStatus: "in_progress" });
    await flush();
    const statusLink = [...c2.querySelectorAll('[data-testid="scope-block-treemap"] a')].find((a) => a.getAttribute("href")?.includes("status=in_progress") || a.getAttribute("aria-pressed") === "true" && a.getAttribute("aria-label")?.includes("in progress"));
    expect(statusLink.getAttribute("aria-pressed")).toBe("true");
    expect(statusLink.getAttribute("href")).toBe("/forge/work?system=Pumps");
  });

  it("a tile never claims active under extra narrowing it does not represent", async () => {
    // activeGroup is "unit=410" -- the system=Pumps tile must not claim active.
    const packages = [PKG({ id: "wp_1", system: "Pumps" })];
    const { container } = render({ packages, activeGroup: { dimension: "unit", key: "410" } });
    await flush();
    const pumpsLink = [...container.querySelectorAll('[data-testid="scope-block-treemap"] a')].find((a) => a.getAttribute("aria-label")?.startsWith("Pumps,"));
    expect(pumpsLink.getAttribute("aria-pressed")).toBe("false");
  });

  it("switching the Table pivot shows exact counts with working row links, agreeing with the treemap", async () => {
    const packages = [
      PKG({ id: "wp_1", system: "Pumps", status: "in_progress" }),
      PKG({ id: "wp_2", system: "Pumps", status: "complete" }),
    ];
    const { container } = render({ packages });
    await flush();
    click(byText(container, "button", "Table"));
    await flush();
    const table = container.querySelector('[data-testid="scope-block-table"]');
    expect(table).not.toBeNull();
    expect(table.textContent).toContain("Pumps");
    expect(table.textContent).toContain("2"); // group total
    const link = [...table.querySelectorAll("a")].find((a) => a.getAttribute("href") === "/forge/work?system=Pumps&status=complete");
    expect(link).toBeTruthy();
  });

  it("switching grouping via the dimension buttons re-groups and persists to localStorage", async () => {
    const packages = [PKG({ id: "wp_1", unit: "410", system: "Pumps" })];
    const { container } = render({ packages, ownerId: "owner_1", forgeProjectKey: "proj_1" });
    await flush();
    click(byText(container, "button", "Unit"));
    await flush();
    const stored = JSON.parse(window.localStorage.getItem("forge.dashboard.scopeBlockMap.v1.owner_1.proj_1"));
    expect(stored.grouping).toBe("unit");
    const groupByGroup = container.querySelector('[aria-label^="Group by"]');
    const activeBtn = [...groupByGroup.querySelectorAll("button")].find((b) => b.getAttribute("aria-pressed") === "true");
    expect(activeBtn.textContent).toBe("Unit");
  });

  it("settings disclosure: closed by default, labelled trigger, conveyed expanded state, Escape-free close via trigger, visible panel controls", async () => {
    const { container } = render({ packages: [PKG({ system: "Pumps" })] });
    await flush();
    expect(container.querySelector('[data-testid="scope-block-settings-panel"]')).toBeNull();
    const trigger = byText(container, "button", "Settings");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    click(trigger);
    await flush();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('[data-testid="scope-block-settings-panel"]')).not.toBeNull();
    click(trigger);
    await flush();
    expect(container.querySelector('[data-testid="scope-block-settings-panel"]')).toBeNull();
  });

  it("title is trimmed and limited to 1-80 characters, and renders as plain text never markup", async () => {
    const { container } = render({ packages: [PKG({ system: "Pumps" })], ownerId: "owner_1", forgeProjectKey: "proj_1" });
    await flush();
    click(byText(container, "button", "Settings"));
    await flush();
    const input = container.querySelector("#scope-block-title");
    expect(input.getAttribute("maxlength")).toBe("80");
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, "<b>Scope</b> map");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();
    const heading = container.querySelector("h2");
    expect(heading.textContent).toBe("<b>Scope</b> map");
    expect(heading.querySelector("b")).toBeNull(); // rendered as text, never as markup
  });

  it("hide/show: visible=false shows a labelled placeholder with a working Show control; clicking it restores the widget", async () => {
    window.localStorage.setItem(
      "forge.dashboard.scopeBlockMap.v1.owner_1.proj_1",
      JSON.stringify({ visible: false, title: "Scope block map", grouping: "system", minLabelPercent: 4, pivot: "treemap" }),
    );
    const { container } = render({ packages: [PKG({ system: "Pumps" })], ownerId: "owner_1", forgeProjectKey: "proj_1" });
    await flush();
    expect(container.querySelector('[data-testid="scope-block-hidden-placeholder"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="scope-block-map"]')).toBeNull();
    const showBtn = byText(container, "button", "Show Scope block map");
    expect(showBtn).toBeTruthy();
    click(showBtn);
    await flush();
    expect(container.querySelector('[data-testid="scope-block-map"]')).not.toBeNull();
  });

  it("Reset to defaults restores documented defaults and closes settings", async () => {
    const { container } = render({ packages: [PKG({ system: "Pumps" })], ownerId: "owner_1", forgeProjectKey: "proj_1" });
    await flush();
    click(byText(container, "button", "Settings"));
    await flush();
    click(byText(container, "button", "Unit"));
    await flush();
    click(byText(container, "button", "Reset to defaults"));
    await flush();
    const stored = JSON.parse(window.localStorage.getItem("forge.dashboard.scopeBlockMap.v1.owner_1.proj_1"));
    expect(stored).toMatchObject({ visible: true, title: "Scope block map", grouping: "system", pivot: "treemap" });
    expect(container.querySelector('[data-testid="scope-block-settings-panel"]')).toBeNull();
  });

  it("preferences are isolated per owner + Forge project key -- two different keys never bleed into each other", async () => {
    const { container: c1 } = render({ packages: [PKG({ system: "Pumps" })], ownerId: "owner_1", forgeProjectKey: "proj_A" });
    await flush();
    click(byText(c1, "button", "Unit"));
    await flush();

    const { container: c2 } = render({ packages: [PKG({ system: "Valves" })], ownerId: "owner_1", forgeProjectKey: "proj_B" });
    await flush();
    const groupByGroup2 = c2.querySelector('[aria-label^="Group by"]');
    const active2 = [...groupByGroup2.querySelectorAll("button")].find((b) => b.getAttribute("aria-pressed") === "true");
    expect(active2.textContent).toBe("Equipment type"); // still the default, unaffected by proj_A's change

    const { container: c3 } = render({ packages: [PKG({ system: "Pumps" })], ownerId: "owner_2", forgeProjectKey: "proj_A" });
    await flush();
    const groupByGroup3 = c3.querySelector('[aria-label^="Group by"]');
    const active3 = [...groupByGroup3.querySelectorAll("button")].find((b) => b.getAttribute("aria-pressed") === "true");
    expect(active3.textContent).toBe("Equipment type"); // a different owner, same project id, also unaffected
  });

  it("a corrupt or out-of-range stored value is ignored field-by-field, never crashing or discarding the whole object", async () => {
    window.localStorage.setItem(
      "forge.dashboard.scopeBlockMap.v1.owner_1.proj_1",
      JSON.stringify({ visible: "not-a-boolean", title: "x".repeat(500), grouping: "not-a-real-dimension", minLabelPercent: 999, pivot: "treemap" }),
    );
    const { container } = render({ packages: [PKG({ system: "Pumps" })], ownerId: "owner_1", forgeProjectKey: "proj_1" });
    await flush();
    // Every invalid field fell back to its default; only the valid
    // pivot field ("treemap") was actually honored.
    expect(container.querySelector('[data-testid="scope-block-map"]')).not.toBeNull(); // visible defaulted true
    const heading = container.querySelector("h2");
    expect(heading.textContent).toBe("Scope block map"); // title defaulted
    const groupByGroup = container.querySelector('[aria-label^="Group by"]');
    const active = [...groupByGroup.querySelectorAll("button")].find((b) => b.getAttribute("aria-pressed") === "true");
    expect(active.textContent).toBe("Equipment type"); // grouping defaulted
  });

  it("genuinely malformed JSON in storage also falls back to defaults instead of crashing", async () => {
    window.localStorage.setItem("forge.dashboard.scopeBlockMap.v1.owner_1.proj_1", "{not valid json");
    const { container } = render({ packages: [PKG({ system: "Pumps" })], ownerId: "owner_1", forgeProjectKey: "proj_1" });
    await flush();
    expect(container.querySelector('[data-testid="scope-block-map"]')).not.toBeNull();
  });

  it("an explicit scopeBy/scopeView URL param overrides a different saved preference, for that render", async () => {
    window.localStorage.setItem(
      "forge.dashboard.scopeBlockMap.v1.owner_1.proj_1",
      JSON.stringify({ visible: true, title: "Scope block map", grouping: "unit", minLabelPercent: 4, pivot: "table" }),
    );
    const { container } = render({
      packages: [PKG({ system: "Pumps" })], ownerId: "owner_1", forgeProjectKey: "proj_1",
      scopeByParam: "system", scopeViewParam: "treemap",
    });
    await flush();
    const groupByGroup = container.querySelector('[aria-label^="Group by"]');
    const active = [...groupByGroup.querySelectorAll("button")].find((b) => b.getAttribute("aria-pressed") === "true");
    expect(active.textContent).toBe("Equipment type");
    expect(container.querySelector('[data-testid="scope-block-treemap"]')).not.toBeNull();
  });

  it("an invalid scopeBy/scopeView URL param is ignored, falling back to the saved preference", async () => {
    window.localStorage.setItem(
      "forge.dashboard.scopeBlockMap.v1.owner_1.proj_1",
      JSON.stringify({ visible: true, title: "Scope block map", grouping: "unit", minLabelPercent: 4, pivot: "table" }),
    );
    const { container } = render({
      packages: [PKG({ unit: "410" })], ownerId: "owner_1", forgeProjectKey: "proj_1",
      scopeByParam: "not-a-real-dimension", scopeViewParam: "not-a-real-view",
    });
    await flush();
    const groupByGroup = container.querySelector('[aria-label^="Group by"]');
    const active = [...groupByGroup.querySelectorAll("button")].find((b) => b.getAttribute("aria-pressed") === "true");
    expect(active.textContent).toBe("Unit");
    expect(container.querySelector('[data-testid="scope-block-table"]')).not.toBeNull();
  });

  it("every missing-value dimension is counted in an explicit, visible, drillable bucket, never silently dropped", async () => {
    const packages = [PKG({ id: "wp_1", system: null }), PKG({ id: "wp_2", system: "Pumps" })];
    const { container } = render({ packages });
    await flush();
    const links = [...container.querySelectorAll('[data-testid="scope-block-treemap"] a')];
    const noneLink = links.find((a) => a.getAttribute("aria-label")?.startsWith("No system,"));
    expect(noneLink).toBeTruthy();
    expect(noneLink.getAttribute("href")).toBe(`/forge/work?system=${encodeURIComponent("__none__")}`);
  });

  it("every group and group+status tile exposes an accessible name even when visually elided below the label threshold", async () => {
    // One tiny group among a dominant one, with a high threshold so the
    // tiny group's visible label is elided -- its accessible name must
    // still carry the full group/status/count content.
    const packages = [
      ...Array.from({ length: 95 }, (_, i) => PKG({ id: `wp_big_${i}`, system: "Pumps" })),
      PKG({ id: "wp_tiny", system: "Valves" }),
    ];
    window.localStorage.setItem(
      "forge.dashboard.scopeBlockMap.v1.owner_1.proj_1",
      JSON.stringify({ visible: true, title: "Scope block map", grouping: "system", minLabelPercent: 20, pivot: "treemap" }),
    );
    const { container } = render({ packages, ownerId: "owner_1", forgeProjectKey: "proj_1" });
    await flush();
    const tinyLink = [...container.querySelectorAll('[data-testid="scope-block-treemap"] a')].find((a) => a.getAttribute("aria-label")?.startsWith("Valves,"));
    expect(tinyLink).toBeTruthy();
    expect(tinyLink.getAttribute("aria-label")).toContain("1 package");
    // Visually elided: no visible count/label span, only the sr-only one.
    expect(tinyLink.querySelector(".sr-only")).not.toBeNull();
  });

  // D3 fix round 1 — P1: with a scopeBy URL override active, clicking a
  // grouping button must update the canonical URL state (not only the
  // local preference, which the override would keep beating).
  it("with a scopeBy URL override active, clicking a grouping button updates the URL state and keeps the local preference in sync", async () => {
    const { container } = render({
      packages: [PKG({ system: "Pumps" })], ownerId: "owner_1", forgeProjectKey: "proj_1",
      scopeByParam: "planner",
    });
    await flush();
    click(byText(container, "button", "Area / zone"));
    await flush();
    expect(navigationMocks.replace).toHaveBeenCalledTimes(1);
    expect(navigationMocks.replace.mock.calls[0][0]).toContain("scopeBy=area");
    const stored = JSON.parse(window.localStorage.getItem("forge.dashboard.scopeBlockMap.v1.owner_1.proj_1"));
    expect(stored.grouping).toBe("area");
  });

  // D3 fix round 1 — P1: same for the Treemap/Table pivot under a
  // scopeView URL override.
  it("with a scopeView URL override active, clicking Treemap updates the URL state", async () => {
    const { container } = render({
      packages: [PKG({ system: "Pumps" })], ownerId: "owner_1", forgeProjectKey: "proj_1",
      scopeViewParam: "table",
    });
    await flush();
    expect(container.querySelector('[data-testid="scope-block-table"]')).not.toBeNull();
    click(byText(container, "button", "Treemap"));
    await flush();
    expect(navigationMocks.replace).toHaveBeenCalledTimes(1);
    expect(navigationMocks.replace.mock.calls[0][0]).toContain("scopeView=treemap");
    const stored = JSON.parse(window.localStorage.getItem("forge.dashboard.scopeBlockMap.v1.owner_1.proj_1"));
    expect(stored.pivot).toBe("treemap");
  });

  // D3 fix round 1 — P1: without an override, grouping clicks stay
  // local-only (no navigation) — the plain-URL behavior is unchanged.
  it("without a URL override, grouping clicks only update local preferences and do not navigate", async () => {
    const { container } = render({ packages: [PKG({ system: "Pumps" })], ownerId: "owner_1", forgeProjectKey: "proj_1" });
    await flush();
    click(byText(container, "button", "Unit"));
    await flush();
    expect(navigationMocks.replace).not.toHaveBeenCalled();
    const stored = JSON.parse(window.localStorage.getItem("forge.dashboard.scopeBlockMap.v1.owner_1.proj_1"));
    expect(stored.grouping).toBe("unit");
  });

  function setTitle(container, value) {
    const input = container.querySelector("#scope-block-title");
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function openSettings(container) {
    click(byText(container, "button", "Settings"));
    await flush();
    expect(container.querySelector('[data-testid="scope-block-settings-panel"]')).not.toBeNull();
  }

  // D3 fix round 1 — P2: a blank title must fall back to the documented
  // default instead of persisting an empty heading.
  it("a blank title falls back to the documented default, never a blank heading", async () => {
    const { container } = render({ packages: [PKG({ system: "Pumps" })], ownerId: "owner_1", forgeProjectKey: "proj_1" });
    await flush();
    await openSettings(container);
    setTitle(container, "");
    await flush();
    expect(container.querySelector("h2").textContent).toBe("Scope block map");
    const stored = JSON.parse(window.localStorage.getItem("forge.dashboard.scopeBlockMap.v1.owner_1.proj_1"));
    expect(stored.title).toBe("Scope block map");
  });

  it("a whitespace-only title falls back to the documented default", async () => {
    const { container } = render({ packages: [PKG({ system: "Pumps" })], ownerId: "owner_1", forgeProjectKey: "proj_1" });
    await flush();
    await openSettings(container);
    setTitle(container, "   ");
    await flush();
    expect(container.querySelector("h2").textContent).toBe("Scope block map");
  });

  it("a 1-character title is kept", async () => {
    const { container } = render({ packages: [PKG({ system: "Pumps" })], ownerId: "owner_1", forgeProjectKey: "proj_1" });
    await flush();
    await openSettings(container);
    setTitle(container, "X");
    await flush();
    expect(container.querySelector("h2").textContent).toBe("X");
  });

  it("an 80-character title renders in full and wraps instead of overflowing the card", async () => {
    const { container } = render({ packages: [PKG({ system: "Pumps" })], ownerId: "owner_1", forgeProjectKey: "proj_1" });
    await flush();
    await openSettings(container);
    const longTitle = "A".repeat(80);
    setTitle(container, longTitle);
    await flush();
    const heading = container.querySelector("h2");
    expect(heading.textContent).toBe(longTitle);
    expect(heading.className).toContain("break-words");
  });

  // D3 fix round 1 — P2: Escape dismisses the settings disclosure and
  // focus returns to the Settings trigger.
  it("Escape closes the settings disclosure and returns focus to the Settings trigger", async () => {
    const { container } = render({ packages: [PKG({ system: "Pumps" })] });
    await flush();
    const trigger = byText(container, "button", "Settings");
    click(trigger);
    await flush();
    const input = container.querySelector("#scope-block-title");
    act(() => { input.focus(); });
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    await flush();
    expect(container.querySelector('[data-testid="scope-block-settings-panel"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  // D3 fix round 1 — P1: treemap group headers meet the ~44px touch
  // target (min-h-11), not the ~24px min-h-6 the verdict measured.
  it("treemap group headers carry the ~44px touch target", async () => {
    const { container } = render({ packages: [PKG({ id: "wp_1", system: "Pumps" }), PKG({ id: "wp_2", system: "Valves" })] });
    await flush();
    const headerLinks = [...container.querySelectorAll('[data-testid="scope-block-treemap"] > div > a')];
    expect(headerLinks.length).toBe(2);
    for (const link of headerLinks) {
      expect(link.className).toContain("min-h-11");
      expect(link.className).not.toContain("min-h-6");
    }
  });

  // D3 fix round 2: Settings must show the EFFECTIVE grouping (URL
  // override wins over stored prefs), never the stored value alone —
  // otherwise the select says one grouping while the widget shows another.
  it("Settings shows the effective grouping under a scopeBy URL override, not the stored grouping", async () => {
    window.localStorage.setItem(
      "forge.dashboard.scopeBlockMap.v1.owner_1.proj_1",
      JSON.stringify({ visible: true, title: "Scope block map", grouping: "unit", minLabelPercent: 4, pivot: "table" }),
    );
    const { container } = render({
      packages: [PKG({ system: "Pumps" })], ownerId: "owner_1", forgeProjectKey: "proj_1",
      scopeByParam: "system", scopeViewParam: "treemap",
    });
    await flush();
    await openSettings(container);
    const select = container.querySelector("#scope-block-grouping");
    expect(select.value).toBe("system");
    // The header pivot buttons already render the effective pivot.
    const treemapBtn = byText(container, "button", "Treemap");
    expect(treemapBtn.getAttribute("aria-pressed")).toBe("true");
  });

  // D3 fix round 2: Reset under a URL override must clear the override
  // params too — resetting only stored prefs leaves the widget showing
  // the URL-pinned grouping/pivot, so "Reset to defaults" visibly does
  // nothing.
  it("Reset under URL overrides removes scopeBy/scopeView from the canonical URL, keeps other params, and restores defaults", async () => {
    window.history.replaceState({}, "", "/forge/work?forgeProject=proj_1&scopeBy=planner&scopeView=table");
    window.localStorage.setItem(
      "forge.dashboard.scopeBlockMap.v1.owner_1.proj_1",
      JSON.stringify({ visible: true, title: "Scope block map", grouping: "unit", minLabelPercent: 4, pivot: "table" }),
    );
    const packages = [PKG({ system: "Pumps" })];
    const { container, root } = render({
      packages, ownerId: "owner_1", forgeProjectKey: "proj_1",
      scopeByParam: "planner", scopeViewParam: "table",
    });
    await flush();
    await openSettings(container);
    click(byText(container, "button", "Reset to defaults"));
    await flush();
    expect(navigationMocks.replace).toHaveBeenCalledTimes(1);
    const resetUrl = navigationMocks.replace.mock.calls[0][0];
    const resetParams = new URLSearchParams(resetUrl.split("?")[1] || "");
    expect(resetParams.has("scopeBy")).toBe(false);
    expect(resetParams.has("scopeView")).toBe(false);
    expect(resetParams.get("forgeProject")).toBe("proj_1");
    const stored = JSON.parse(window.localStorage.getItem("forge.dashboard.scopeBlockMap.v1.owner_1.proj_1"));
    expect(stored).toMatchObject({ visible: true, title: "Scope block map", grouping: "system", pivot: "treemap" });
    expect(container.querySelector('[data-testid="scope-block-settings-panel"]')).toBeNull();
    // Simulate the server re-render after the navigation: with the
    // overrides gone, the widget must visibly show the defaults.
    act(() => {
      root.render(<PlannerScopeBlockMap baseHref="/forge/work" packages={packages} ownerId="owner_1" forgeProjectKey="proj_1" />);
    });
    await flush();
    const groupByGroup = container.querySelector('[aria-label^="Group by"]');
    const active = [...groupByGroup.querySelectorAll("button")].find((b) => b.getAttribute("aria-pressed") === "true");
    expect(active.textContent).toBe("Equipment type");
    expect(container.querySelector('[data-testid="scope-block-treemap"]')).not.toBeNull();
  });

  // D3 fix round 2: without overrides, Reset stays local-only (no
  // navigation) — the plain-URL behavior is unchanged.
  it("Reset without URL overrides stays local-only and does not navigate", async () => {
    const { container } = render({ packages: [PKG({ system: "Pumps" })], ownerId: "owner_1", forgeProjectKey: "proj_1" });
    await flush();
    await openSettings(container);
    click(byText(container, "button", "Unit"));
    await flush();
    click(byText(container, "button", "Reset to defaults"));
    await flush();
    expect(navigationMocks.replace).not.toHaveBeenCalled();
    const stored = JSON.parse(window.localStorage.getItem("forge.dashboard.scopeBlockMap.v1.owner_1.proj_1"));
    expect(stored).toMatchObject({ grouping: "system", pivot: "treemap" });
  });

  // D3 fix round 2: two rapid changes under overrides must both land —
  // router.replace is async, so building each replace from the live URL
  // would let the second call overwrite the first.
  it("rapid grouping then pivot changes under overrides both land in the canonical URL", async () => {
    window.history.replaceState({}, "", "/forge/work?forgeProject=proj_1&scopeBy=planner&scopeView=table");
    const { container } = render({
      packages: [PKG({ system: "Pumps" })], ownerId: "owner_1", forgeProjectKey: "proj_1",
      scopeByParam: "planner", scopeViewParam: "table",
    });
    await flush();
    click(byText(container, "button", "Area / zone"));
    click(byText(container, "button", "Treemap"));
    await flush();
    expect(navigationMocks.replace).toHaveBeenCalledTimes(2);
    const lastUrl = navigationMocks.replace.mock.calls[1][0];
    const params = new URLSearchParams(lastUrl.split("?")[1] || "");
    expect(params.get("scopeBy")).toBe("area");
    expect(params.get("scopeView")).toBe("treemap");
    expect(params.get("forgeProject")).toBe("proj_1");
  });

  it("rapid pivot then grouping changes under overrides both land in the canonical URL", async () => {
    window.history.replaceState({}, "", "/forge/work?forgeProject=proj_1&scopeBy=planner&scopeView=table");
    const { container } = render({
      packages: [PKG({ system: "Pumps" })], ownerId: "owner_1", forgeProjectKey: "proj_1",
      scopeByParam: "planner", scopeViewParam: "table",
    });
    await flush();
    click(byText(container, "button", "Treemap"));
    click(byText(container, "button", "Area / zone"));
    await flush();
    expect(navigationMocks.replace).toHaveBeenCalledTimes(2);
    const lastUrl = navigationMocks.replace.mock.calls[1][0];
    const params = new URLSearchParams(lastUrl.split("?")[1] || "");
    expect(params.get("scopeBy")).toBe("area");
    expect(params.get("scopeView")).toBe("treemap");
    expect(params.get("forgeProject")).toBe("proj_1");
  });

  // D3 fix round 2: a cleared-preference reload preserves the
  // documented defaults where the URL does not override — and the URL
  // grouping where it does.
  it("a cleared-preference reload shows documented defaults where the URL does not override, and the URL grouping where it does", async () => {
    const packages = [PKG({ system: "Pumps" })];
    const { container, root } = render({ packages, ownerId: "owner_1", forgeProjectKey: "proj_1", scopeByParam: "planner" });
    await flush();
    const groupByGroup = container.querySelector('[aria-label^="Group by"]');
    const active = [...groupByGroup.querySelectorAll("button")].find((b) => b.getAttribute("aria-pressed") === "true");
    expect(active.textContent).toBe("Planner");
    // Simulate the reload after clearing saved prefs, with no override.
    act(() => {
      root.render(<PlannerScopeBlockMap baseHref="/forge/work" packages={packages} ownerId="owner_1" forgeProjectKey="proj_1" />);
    });
    await flush();
    const groupByGroup2 = container.querySelector('[aria-label^="Group by"]');
    const active2 = [...groupByGroup2.querySelectorAll("button")].find((b) => b.getAttribute("aria-pressed") === "true");
    expect(active2.textContent).toBe("Equipment type");
    expect(container.querySelector('[data-testid="scope-block-treemap"]')).not.toBeNull();
  });

  // D3 fix round 3: the "Power distribution" group header must show
  // the full label at phone width — the verdict measured ~17px of
  // clipping at 392px from the old truncate. The header wraps the
  // label (break-words, flex-wrap) instead of truncating it, keeps
  // the exact drill href, and keeps the full accessible name.
  it("the Power distribution group header shows the full label and count with the exact drill link", async () => {
    const packages = [
      PKG({ id: "wp_1", system: "Exchanger" }),
      PKG({ id: "wp_2", system: "Pumping" }),
      PKG({ id: "wp_3", system: "Piping" }),
      PKG({ id: "wp_4", system: "Piping" }),
      PKG({ id: "wp_5", system: "Power distribution" }),
      PKG({ id: "wp_6", system: "Instrumentation" }),
    ];
    const { container } = render({ packages });
    await flush();
    const headerLinks = [...container.querySelectorAll('[data-testid="scope-block-treemap"] > div > a')];
    expect(headerLinks.length).toBe(5);
    const powerLink = headerLinks.find((a) => a.getAttribute("aria-label")?.startsWith("Power distribution,"));
    expect(powerLink).toBeTruthy();
    expect(powerLink.getAttribute("href")).toBe("/forge/work?system=Power%20distribution");
    expect(powerLink.getAttribute("aria-label")).toContain("Power distribution, 1 package");
    // The visible label is the full text, never an ellipsis cut, and
    // the markup lets it wrap (break-words) instead of truncating.
    const labelSpan = powerLink.querySelector("span:not(.sr-only)");
    expect(labelSpan.textContent).toBe("Power distribution");
    expect(labelSpan.className).toContain("break-words");
    expect(labelSpan.className).not.toContain("truncate");
    expect(powerLink.className).toContain("flex-wrap");
    expect(powerLink.className).not.toContain("truncate");
    // Counts still reconcile: 2 + 1 + 1 + 1 + 1 = 6 packages.
    const counts = headerLinks.map((a) => a.querySelector("span:not(.sr-only) + span")?.textContent);
    expect(counts.sort()).toEqual(["1", "1", "1", "1", "2"]);
  });

  it("group and status drills are unchanged for the full fixture set", async () => {
    const packages = [
      PKG({ id: "wp_1", system: "Exchanger", status: "draft" }),
      PKG({ id: "wp_2", system: "Pumping", status: "in_progress" }),
      PKG({ id: "wp_3", system: "Piping", status: "draft" }),
      PKG({ id: "wp_4", system: "Piping", status: "draft" }),
      PKG({ id: "wp_5", system: "Power distribution", status: "complete" }),
      PKG({ id: "wp_6", system: "Instrumentation", status: "draft" }),
    ];
    const { container } = render({ packages });
    await flush();
    const links = [...container.querySelectorAll('[data-testid="scope-block-treemap"] a')];
    const pipingDraft = links.find((a) => a.getAttribute("href") === "/forge/work?system=Piping&status=draft");
    expect(pipingDraft).toBeTruthy();
    expect(pipingDraft.getAttribute("aria-label")).toContain("Piping, draft, 2 packages");
    const powerComplete = links.find((a) => a.getAttribute("href") === "/forge/work?system=Power+distribution&status=complete");
    expect(powerComplete).toBeTruthy();
    expect(powerComplete.getAttribute("aria-label")).toContain("Power distribution, complete, 1 package");
  });

  // D3 fix round 3 — negative control at the component level: a single
  // unbreakable 34-character token cannot wrap at a word boundary, so
  // the label must still break the word (break-words) and keep the
  // full text in the DOM — never silently truncate it to an ellipsis.
  it("a single unbreakable long label still renders in full with break-words, never truncated", async () => {
    const longToken = "Supercalifragilisticexpialidocious";
    const { container } = render({ packages: [PKG({ system: longToken })] });
    await flush();
    const headerLink = container.querySelector('[data-testid="scope-block-treemap"] > div > a');
    expect(headerLink).toBeTruthy();
    const labelSpan = headerLink.querySelector("span:not(.sr-only)");
    expect(labelSpan.textContent).toBe(longToken);
    expect(labelSpan.className).toContain("break-words");
    expect(labelSpan.className).not.toContain("truncate");
    expect(headerLink.getAttribute("aria-label")).toContain(`${longToken}, 1 package`);
  });

  // D5 export CSV — the block map exports from its header and from the
  // hidden placeholder, with every tile present regardless of the
  // label threshold.
  describe("D5 export CSV", () => {
    function parseCsv(text) {
      const rows = [];
      let row = [];
      let field = "";
      let inQuotes = false;
      for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (inQuotes) {
          if (ch === '"') {
            if (text[i + 1] === '"') { field += '"'; i += 1; }
            else inQuotes = false;
          } else field += ch;
        } else if (ch === '"') inQuotes = true;
        else if (ch === ",") { row.push(field); field = ""; }
        else if (ch === "\r" && text[i + 1] === "\n") { row.push(field); rows.push(row); row = []; field = ""; i += 1; }
        else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
        else field += ch;
      }
      if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
      return rows;
    }

    let download = null;
    afterEach(() => {
      download?.restore();
      download = null;
    });

    function setupDownload() {
      const captured = { blob: null, anchors: [] };
      const originalCreate = URL.createObjectURL;
      const originalRevoke = URL.revokeObjectURL;
      URL.createObjectURL = vi.fn((blob) => { captured.blob = blob; return "blob:fake"; });
      URL.revokeObjectURL = vi.fn();
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
        captured.anchors.push({ href: this.href, download: this.download });
      });
      download = {
        captured,
        restore() {
          URL.createObjectURL = originalCreate;
          URL.revokeObjectURL = originalRevoke;
          clickSpy.mockRestore();
        },
      };
      return download;
    }

    async function clickExport(container, label) {
      const dl = setupDownload();
      const button = [...container.querySelectorAll("button")].find(
        (candidate) => candidate.getAttribute("aria-label") === label,
      );
      expect(button).toBeDefined();
      await act(async () => {
        button.click();
      });
      expect(dl.captured.anchors).toHaveLength(1);
      return { download: dl.captured.anchors[0].download, csvText: await dl.captured.blob.text() };
    }

    it("the header has a labelled Export CSV control", async () => {
      const { container } = render({ packages: [PKG({ system: "Pumps" })], ownerId: "owner_1", forgeProjectKey: "proj_1" });
      await flush();
      const button = [...container.querySelectorAll("button")].find(
        (candidate) => candidate.getAttribute("aria-label") === "Export Scope block map as CSV",
      );
      expect(button).toBeDefined();
      expect(button.disabled).toBe(false);
    });

    it("export downloads group tiles and totals matching the treemap", async () => {
      const { container } = render({
        packages: [
          PKG({ id: "wp_1", system: "Pumps", status: "draft" }),
          PKG({ id: "wp_2", system: "Pumps", status: "in_progress" }),
          PKG({ id: "wp_3", system: null, status: "draft" }),
        ],
        ownerId: "owner_1",
        forgeProjectKey: "proj_1",
      });
      await flush();
      const { csvText } = await clickExport(container, "Export Scope block map as CSV");
      const rows = parseCsv(csvText);
      const header = rows[0];
      const tiles = rows.slice(1).filter((r) => r[0] === "data");
      expect(tiles).toHaveLength(3);
      const totals = rows.slice(1).filter((r) => r[0] === "total");
      expect(totals).toHaveLength(2);
      expect(totals.find((r) => r[header.indexOf("group_label")] === "Pumps")[header.indexOf("value_count")]).toBe("2");
      expect(totals.find((r) => r[header.indexOf("group_label")] === "No system")[header.indexOf("value_count")]).toBe("1");
    });

    it("the hidden placeholder exports the hidden widget and records visible=false", async () => {
      window.localStorage.setItem(
        "forge.dashboard.scopeBlockMap.v1.owner_1.proj_1",
        JSON.stringify({ visible: false, title: "Scope block map", grouping: "system", minLabelPercent: 4, pivot: "treemap" }),
      );
      const { container } = render({
        packages: [PKG({ id: "wp_1", system: "Pumps", status: "draft" })],
        ownerId: "owner_1",
        forgeProjectKey: "proj_1",
      });
      await flush();
      expect(container.querySelector('[data-testid="scope-block-hidden-placeholder"]')).not.toBeNull();
      const { csvText } = await clickExport(container, "Export Scope block map as CSV");
      const rows = parseCsv(csvText);
      expect(JSON.parse(rows[1][8]).visible).toBe(false);
      expect(rows.slice(1).filter((r) => r[0] === "data")).toHaveLength(1);
    });

    it("the label threshold never drops rows from the export", async () => {
      window.localStorage.setItem(
        "forge.dashboard.scopeBlockMap.v1.owner_1.proj_1",
        JSON.stringify({ visible: true, title: "Scope block map", grouping: "system", minLabelPercent: 25, pivot: "treemap" }),
      );
      const packages = Array.from({ length: 9 }, (_, i) => PKG({ id: `wp_big_${i}`, system: "Pumps", status: "draft" }));
      packages.push(PKG({ id: "wp_small", system: "Valves", status: "draft" }));
      const { container } = render({ packages, ownerId: "owner_1", forgeProjectKey: "proj_1" });
      await flush();
      const { csvText } = await clickExport(container, "Export Scope block map as CSV");
      const rows = parseCsv(csvText);
      const header = rows[0];
      const tiles = rows.slice(1).filter((r) => r[0] === "data");
      expect(tiles.some((r) => r[header.indexOf("group_label")] === "Valves")).toBe(true);
    });

    it("the export records the EFFECTIVE grouping/pivot under a URL override, not the saved prefs", async () => {
      // Saved prefs say system/treemap; the URL pins planner/table —
      // the widget renders the override, so the export must record it.
      window.localStorage.setItem(
        "forge.dashboard.scopeBlockMap.v1.owner_1.proj_1",
        JSON.stringify({ visible: true, title: "Scope block map", grouping: "system", minLabelPercent: 4, pivot: "treemap" }),
      );
      const { container } = render({
        packages: [PKG({ system: "Pumps" })], ownerId: "owner_1", forgeProjectKey: "proj_1",
        scopeByParam: "planner", scopeViewParam: "table",
      });
      await flush();
      const { csvText } = await clickExport(container, "Export Scope block map as CSV");
      const rows = parseCsv(csvText);
      const config = JSON.parse(rows[1][8]);
      expect(config.grouping).toBe("planner");
      expect(config.pivot).toBe("table");
    });
  });
});
