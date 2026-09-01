import { describe, expect, it } from "vitest";
import { findContrastIssues, findKeyboardFocusVisibilityIssues, findMissingAccessibleNames, findUndersizedTouchTargets } from "../accessibilityRules.mjs";
import { FINDING_CATEGORY } from "../findingContracts.mjs";
import { MINIMUM_TOUCH_TARGET_PX } from "../diagnosticsSnapshotScript.mjs";

const baseContext = { application: "app", routeId: "home", routePath: "/", viewport: "desktop", screenshotHash: `sha256:${"a".repeat(64)}` };

function el(overrides = {}) {
  return {
    selector: "p#x", tagName: "p", isInteractive: false, visible: true, text: "Some real text",
    accessibleName: "", focusVisibleChanged: null,
    computedStyle: { color: "rgb(0,0,0)", effectiveBackgroundColor: "rgb(255,255,255)", fontSizePx: 14, fontWeight: "400" },
    ...overrides,
  };
}

function snapshot(elements, colorScheme = "light") {
  return { documentMetrics: { colorScheme }, elements, statusMarkers: [], chartMarkers: [], emptyStateMarkers: [], spacingSamples: [] };
}

describe("findContrastIssues", () => {
  it("finds nothing for high-contrast black-on-white text", () => {
    expect(findContrastIssues({ ...baseContext, snapshot: snapshot([el()]) })).toEqual([]);
  });

  it("flags light-gray-on-white text as unreadable contrast in light mode", () => {
    const findings = findContrastIssues({ ...baseContext, snapshot: snapshot([el({ computedStyle: { color: "rgb(204,204,204)", effectiveBackgroundColor: "rgb(255,255,255)", fontSizePx: 14, fontWeight: "400" } })]) });
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe(FINDING_CATEGORY.UNREADABLE_CONTRAST);
  });

  it("categorizes the same low-contrast pairing as missing-dark-mode-foreground when colorScheme is dark", () => {
    const findings = findContrastIssues({
      ...baseContext,
      snapshot: snapshot([el({ computedStyle: { color: "rgb(60,60,60)", effectiveBackgroundColor: "rgb(30,30,30)", fontSizePx: 14, fontWeight: "400" } })], "dark"),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe(FINDING_CATEGORY.MISSING_DARK_MODE_FOREGROUND);
  });

  it("skips an element with no text content", () => {
    expect(findContrastIssues({ ...baseContext, snapshot: snapshot([el({ text: "", computedStyle: { color: "rgb(204,204,204)", effectiveBackgroundColor: "rgb(255,255,255)", fontSizePx: 14, fontWeight: "400" } })]) })).toEqual([]);
  });

  it("skips an element with an unparseable/transparent effective background rather than guessing", () => {
    expect(findContrastIssues({ ...baseContext, snapshot: snapshot([el({ computedStyle: { color: "rgb(204,204,204)", effectiveBackgroundColor: "transparent", fontSizePx: 14, fontWeight: "400" } })]) })).toEqual([]);
  });

  it("uses the lower 3:1 UI-component threshold for interactive elements", () => {
    // ~3.5:1 -- fails the 4.5:1 normal-text bar but passes the 3:1 UI-component bar.
    const marginal = { color: "rgb(120,120,120)", effectiveBackgroundColor: "rgb(255,255,255)", fontSizePx: 14, fontWeight: "400" };
    const asText = findContrastIssues({ ...baseContext, snapshot: snapshot([el({ isInteractive: false, computedStyle: marginal })]) });
    const asControl = findContrastIssues({ ...baseContext, snapshot: snapshot([el({ isInteractive: true, computedStyle: marginal })]) });
    expect(asText.length).toBeGreaterThan(0);
    expect(asControl).toEqual([]);
  });
});

describe("findUndersizedTouchTargets", () => {
  it("finds nothing for a control at or above the minimum", () => {
    const elements = [el({ isInteractive: true, rect: { width: MINIMUM_TOUCH_TARGET_PX, height: MINIMUM_TOUCH_TARGET_PX } })];
    expect(findUndersizedTouchTargets({ ...baseContext, snapshot: snapshot(elements) })).toEqual([]);
  });

  it("flags a control below the minimum in either dimension", () => {
    const elements = [el({ isInteractive: true, rect: { width: 18, height: 18 } })];
    const findings = findUndersizedTouchTargets({ ...baseContext, snapshot: snapshot(elements) });
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe(FINDING_CATEGORY.UNDERSIZED_TOUCH_TARGET);
  });

  it("ignores non-interactive elements", () => {
    const elements = [el({ isInteractive: false, rect: { width: 5, height: 5 } })];
    expect(findUndersizedTouchTargets({ ...baseContext, snapshot: snapshot(elements) })).toEqual([]);
  });
});

describe("findMissingAccessibleNames", () => {
  it("finds nothing when an interactive element has an accessible name", () => {
    const elements = [el({ isInteractive: true, accessibleName: "Save" })];
    expect(findMissingAccessibleNames({ ...baseContext, snapshot: snapshot(elements) })).toEqual([]);
  });

  it("flags an interactive element with no accessible name", () => {
    const elements = [el({ isInteractive: true, accessibleName: "" })];
    const findings = findMissingAccessibleNames({ ...baseContext, snapshot: snapshot(elements) });
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe(FINDING_CATEGORY.MISSING_ACCESSIBLE_NAME);
    expect(findings[0].severity).toBe("high");
  });
});

describe("findKeyboardFocusVisibilityIssues", () => {
  it("finds nothing when focus visibly changes the element's style", () => {
    const elements = [el({ isInteractive: true, focusVisibleChanged: true })];
    expect(findKeyboardFocusVisibilityIssues({ ...baseContext, snapshot: snapshot(elements) })).toEqual([]);
  });

  it("flags an interactive element whose style never changes on focus", () => {
    const elements = [el({ isInteractive: true, focusVisibleChanged: false })];
    const findings = findKeyboardFocusVisibilityIssues({ ...baseContext, snapshot: snapshot(elements) });
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe(FINDING_CATEGORY.KEYBOARD_FOCUS_VISIBILITY);
  });

  it("does not flag when focus measurement was unavailable (null), rather than assuming a defect", () => {
    const elements = [el({ isInteractive: true, focusVisibleChanged: null })];
    expect(findKeyboardFocusVisibilityIssues({ ...baseContext, snapshot: snapshot(elements) })).toEqual([]);
  });
});
