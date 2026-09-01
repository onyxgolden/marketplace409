import { describe, expect, it } from "vitest";
import { findClippedOrTruncatedControls, findHorizontalOverflow, findInconsistentSpacing, findOverlappingContent } from "../layoutRules.mjs";
import { FINDING_CATEGORY } from "../findingContracts.mjs";

const baseContext = { application: "app", routeId: "home", routePath: "/", viewport: "mobile", screenshotHash: `sha256:${"a".repeat(64)}` };

function snapshot(overrides = {}) {
  return {
    documentMetrics: { scrollWidth: 390, clientWidth: 390 },
    elements: [], statusMarkers: [], chartMarkers: [], emptyStateMarkers: [], spacingSamples: [],
    ...overrides,
  };
}

describe("findHorizontalOverflow", () => {
  it("finds nothing when scrollWidth matches clientWidth", () => {
    expect(findHorizontalOverflow({ ...baseContext, snapshot: snapshot() })).toEqual([]);
  });

  it("flags overflow when scrollWidth exceeds clientWidth", () => {
    const findings = findHorizontalOverflow({ ...baseContext, snapshot: snapshot({ documentMetrics: { scrollWidth: 620, clientWidth: 390 } }) });
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe(FINDING_CATEGORY.HORIZONTAL_OVERFLOW);
    expect(findings[0].severity).toBe("high"); // 230px overflow > 100px
  });

  it("tolerates a 1px rounding difference", () => {
    expect(findHorizontalOverflow({ ...baseContext, snapshot: snapshot({ documentMetrics: { scrollWidth: 390.6, clientWidth: 390 } }) })).toEqual([]);
  });
});

describe("findClippedOrTruncatedControls", () => {
  it("finds nothing when no interactive element overflows its own box", () => {
    const elements = [{ selector: "button#x", isInteractive: true, visible: true, overflow: { scrollWidth: 100, clientWidth: 100 } }];
    expect(findClippedOrTruncatedControls({ ...baseContext, snapshot: snapshot({ elements }) })).toEqual([]);
  });

  it("flags an interactive element whose content is wider than its box", () => {
    const elements = [{ selector: "button#x", isInteractive: true, visible: true, overflow: { scrollWidth: 160, clientWidth: 100 } }];
    const findings = findClippedOrTruncatedControls({ ...baseContext, snapshot: snapshot({ elements }) });
    expect(findings).toHaveLength(1);
    expect(findings[0].affectedComponent).toBe("button#x");
  });

  it("ignores non-interactive elements even if they overflow", () => {
    const elements = [{ selector: "div#x", isInteractive: false, visible: true, overflow: { scrollWidth: 160, clientWidth: 100 } }];
    expect(findClippedOrTruncatedControls({ ...baseContext, snapshot: snapshot({ elements }) })).toEqual([]);
  });

  it("ignores invisible elements", () => {
    const elements = [{ selector: "button#x", isInteractive: true, visible: false, overflow: { scrollWidth: 160, clientWidth: 100 } }];
    expect(findClippedOrTruncatedControls({ ...baseContext, snapshot: snapshot({ elements }) })).toEqual([]);
  });
});

describe("findOverlappingContent", () => {
  it("finds nothing for two elements that don't overlap", () => {
    const elements = [
      { selector: "div:nth-child(1)", visible: true, rect: { x: 0, y: 0, width: 100, height: 100 } },
      { selector: "div:nth-child(2)", visible: true, rect: { x: 200, y: 0, width: 100, height: 100 } },
    ];
    expect(findOverlappingContent({ ...baseContext, snapshot: snapshot({ elements }) })).toEqual([]);
  });

  it("flags two unrelated elements that substantially overlap", () => {
    const elements = [
      { selector: "div:nth-child(1)", visible: true, rect: { x: 0, y: 0, width: 100, height: 100 } },
      { selector: "section:nth-child(2)", visible: true, rect: { x: 20, y: 20, width: 100, height: 100 } },
    ];
    const findings = findOverlappingContent({ ...baseContext, snapshot: snapshot({ elements }) });
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe(FINDING_CATEGORY.OVERLAPPING_CONTENT);
  });

  it("does not flag an ancestor/descendant pair (a container fully containing its own child)", () => {
    const elements = [
      { selector: "div#parent", visible: true, rect: { x: 0, y: 0, width: 300, height: 300 } },
      { selector: "div#parent > span:nth-child(1)", visible: true, rect: { x: 10, y: 10, width: 50, height: 20 } },
    ];
    expect(findOverlappingContent({ ...baseContext, snapshot: snapshot({ elements }) })).toEqual([]);
  });

  it("does not flag a trivial/sliver overlap below the area threshold", () => {
    const elements = [
      { selector: "div:nth-child(1)", visible: true, rect: { x: 0, y: 0, width: 100, height: 100 } },
      { selector: "section:nth-child(2)", visible: true, rect: { x: 98, y: 98, width: 100, height: 100 } },
    ];
    expect(findOverlappingContent({ ...baseContext, snapshot: snapshot({ elements }) })).toEqual([]);
  });
});

describe("findInconsistentSpacing", () => {
  it("finds nothing when gaps fall on the 4px grid", () => {
    const spacingSamples = [{ group: "g1", selectorA: "a", selectorB: "b", gapPx: 16 }];
    expect(findInconsistentSpacing({ ...baseContext, snapshot: snapshot({ spacingSamples }) })).toEqual([]);
  });

  it("flags a gap that doesn't fall on the grid", () => {
    const spacingSamples = [{ group: "g1", selectorA: "a", selectorB: "b", gapPx: 6 }];
    const findings = findInconsistentSpacing({ ...baseContext, snapshot: snapshot({ spacingSamples }) });
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe(FINDING_CATEGORY.INCONSISTENT_SPACING);
  });

  it("produces no findings when no route has opted into the spacing-group convention", () => {
    expect(findInconsistentSpacing({ ...baseContext, snapshot: snapshot() })).toEqual([]);
  });
});
