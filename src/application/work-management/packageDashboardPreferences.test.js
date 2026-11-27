// D4.1 package dashboard — device-local preferences. Fail-before: these
// tests pin the contract before the module exists.
import { describe, expect, it } from "vitest";

import {
  DEFAULT_TITLES,
  defaultPreferences,
  parsePreferences,
  preferenceKey,
  serializePreferences,
  validateWidgetTitle,
  WIDGET_IDS,
} from "./packageDashboardPreferences.js";

describe("preferenceKey", () => {
  it("scopes the key by owner, project, and package", () => {
    expect(preferenceKey({ ownerId: "owner_1", forgeProjectId: "forge_project_1", packageId: "pkg_1" }))
      .toBe("forge-wpp-package-dashboard-v1:owner_1:forge_project_1:pkg_1");
    expect(preferenceKey({ ownerId: null, forgeProjectId: "unassigned", packageId: "pkg_1" }))
      .toBe("forge-wpp-package-dashboard-v1:default:unassigned:pkg_1");
  });

  it("sanitizes key parts so two scopes can never collide", () => {
    expect(preferenceKey({ ownerId: "a:b", forgeProjectId: "c", packageId: "d" }))
      .toBe("forge-wpp-package-dashboard-v1:a-b:c:d");
  });
});

describe("defaultPreferences", () => {
  it("covers every widget with its documented default pivot", () => {
    const prefs = defaultPreferences();
    expect(prefs.version).toBe(1);
    expect(Object.keys(prefs.widgets).sort()).toEqual([...WIDGET_IDS].sort());
    expect(prefs.widgets.strip.pivot).toBe("cards");
    expect(prefs.widgets.planning.pivot).toBe("bars");
    expect(prefs.widgets.cost.pivot).toBe("donut");
    expect(prefs.widgets.changeOrders.pivot).toBe("strip");
    for (const id of WIDGET_IDS) {
      expect(prefs.widgets[id]).toMatchObject({ hidden: false, title: null });
    }
  });
});

describe("parsePreferences", () => {
  it("round-trips a valid stored value", () => {
    const prefs = defaultPreferences();
    prefs.widgets.cost.title = "My cost view";
    prefs.widgets.cost.pivot = "table";
    prefs.widgets.planning.hidden = true;
    expect(parsePreferences(serializePreferences(prefs))).toEqual(prefs);
    expect(parsePreferences(prefs)).toEqual(prefs);
  });

  it("falls back to defaults on corrupt input", () => {
    expect(parsePreferences("not json")).toEqual(defaultPreferences());
    expect(parsePreferences(null)).toEqual(defaultPreferences());
    expect(parsePreferences(42)).toEqual(defaultPreferences());
    expect(parsePreferences({ version: 99, widgets: {} })).toEqual(defaultPreferences());
  });

  it("recovers field by field: one bad field never wipes the rest", () => {
    const parsed = parsePreferences({
      version: 1,
      widgets: {
        cost: { hidden: "yes", title: "   ", pivot: "pie" },
        strip: { hidden: true, title: "Strip title", pivot: "table" },
        unknownWidget: { hidden: true },
      },
    });
    expect(parsed.widgets.cost).toEqual({ hidden: false, title: null, pivot: "donut" });
    expect(parsed.widgets.strip).toEqual({ hidden: true, title: "Strip title", pivot: "table" });
    expect(parsed.widgets.planning).toEqual(defaultPreferences().widgets.planning);
    expect(parsed.widgets.unknownWidget).toBeUndefined();
  });
});

describe("validateWidgetTitle", () => {
  it("trims and accepts 1–80 characters, rejects the rest", () => {
    expect(validateWidgetTitle("  My title  ")).toEqual({ ok: true, title: "My title" });
    expect(validateWidgetTitle("X")).toEqual({ ok: true, title: "X" });
    expect(validateWidgetTitle("A".repeat(80))).toEqual({ ok: true, title: "A".repeat(80) });
    expect(validateWidgetTitle("")).toEqual({ ok: false, error: expect.any(String) });
    expect(validateWidgetTitle("   ")).toEqual({ ok: false, error: expect.any(String) });
    expect(validateWidgetTitle("A".repeat(81))).toEqual({ ok: false, error: expect.any(String) });
    expect(validateWidgetTitle("bad\ntitle")).toEqual({ ok: false, error: expect.any(String) });
    expect(validateWidgetTitle(null)).toEqual({ ok: false, error: expect.any(String) });
  });
});

describe("DEFAULT_TITLES", () => {
  it("names every widget", () => {
    for (const id of WIDGET_IDS) {
      expect(typeof DEFAULT_TITLES[id]).toBe("string");
      expect(DEFAULT_TITLES[id].length).toBeGreaterThan(0);
    }
  });
});
