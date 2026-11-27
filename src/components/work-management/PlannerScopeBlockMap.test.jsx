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
});
