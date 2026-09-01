import { describe, expect, it } from "vitest";
import { findEmptyStateLayoutDefects, findMisleadingCharts, findStatusCommunicationIssues } from "../contentStateRules.mjs";
import { FINDING_CATEGORY } from "../findingContracts.mjs";

const baseContext = { application: "app", routeId: "home", routePath: "/", viewport: "desktop", screenshotHash: `sha256:${"a".repeat(64)}` };

function snapshot(overrides = {}) {
  return { documentMetrics: {}, elements: [], statusMarkers: [], chartMarkers: [], emptyStateMarkers: [], spacingSamples: [], ...overrides };
}

describe("findEmptyStateLayoutDefects", () => {
  it("finds nothing for an empty-state marker with visible content", () => {
    const emptyStateMarkers = [{ selector: "#es", isEmpty: true, rect: { width: 300, height: 60 } }];
    expect(findEmptyStateLayoutDefects({ ...baseContext, snapshot: snapshot({ emptyStateMarkers }) })).toEqual([]);
  });

  it("flags an empty-state marker that rendered nothing at all", () => {
    const emptyStateMarkers = [{ selector: "#es", isEmpty: true, rect: { width: 0, height: 0 } }];
    const findings = findEmptyStateLayoutDefects({ ...baseContext, snapshot: snapshot({ emptyStateMarkers }) });
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe(FINDING_CATEGORY.EMPTY_STATE_LAYOUT_DEFECT);
  });

  it("ignores a marker not currently in the empty state", () => {
    const emptyStateMarkers = [{ selector: "#es", isEmpty: false, rect: { width: 0, height: 0 } }];
    expect(findEmptyStateLayoutDefects({ ...baseContext, snapshot: snapshot({ emptyStateMarkers }) })).toEqual([]);
  });
});

describe("findStatusCommunicationIssues", () => {
  it("finds nothing when a status region has text", () => {
    const statusMarkers = [{ selector: "[role=status]", role: "status", text: "Loading account balances…" }];
    expect(findStatusCommunicationIssues({ ...baseContext, snapshot: snapshot({ statusMarkers }) })).toEqual([]);
  });

  it("flags a status region with no text", () => {
    const statusMarkers = [{ selector: "[role=status]", role: "status", text: "" }];
    const findings = findStatusCommunicationIssues({ ...baseContext, snapshot: snapshot({ statusMarkers }) });
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe(FINDING_CATEGORY.LOADING_ERROR_STATUS_COMMUNICATION);
  });

  it("flags an empty alert region too", () => {
    const statusMarkers = [{ selector: "[role=alert]", role: "alert", text: "" }];
    const findings = findStatusCommunicationIssues({ ...baseContext, snapshot: snapshot({ statusMarkers }) });
    expect(findings[0].explanation).toContain("what went wrong");
  });
});

describe("findMisleadingCharts", () => {
  it("finds nothing for a chart with a range label and no incomplete-period issue", () => {
    const chartMarkers = [{ selector: "#chart", hasRangeLabel: true, declaredIncomplete: false, communicatesIncomplete: false }];
    expect(findMisleadingCharts({ ...baseContext, snapshot: snapshot({ chartMarkers }) })).toEqual([]);
  });

  it("flags a chart with no range label", () => {
    const chartMarkers = [{ selector: "#chart", hasRangeLabel: false, declaredIncomplete: false, communicatesIncomplete: false }];
    const findings = findMisleadingCharts({ ...baseContext, snapshot: snapshot({ chartMarkers }) });
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe("misleading-chart-no-range-label");
  });

  it("flags a chart that's incomplete but doesn't say so", () => {
    const chartMarkers = [{ selector: "#chart", hasRangeLabel: true, declaredIncomplete: true, communicatesIncomplete: false }];
    const findings = findMisleadingCharts({ ...baseContext, snapshot: snapshot({ chartMarkers }) });
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe("misleading-chart-incomplete-period");
    expect(findings[0].severity).toBe("high");
  });

  it("can produce both findings at once for the same chart", () => {
    const chartMarkers = [{ selector: "#chart", hasRangeLabel: false, declaredIncomplete: true, communicatesIncomplete: false }];
    expect(findMisleadingCharts({ ...baseContext, snapshot: snapshot({ chartMarkers }) })).toHaveLength(2);
  });

  it("does not flag an incomplete chart that already communicates it", () => {
    const chartMarkers = [{ selector: "#chart", hasRangeLabel: true, declaredIncomplete: true, communicatesIncomplete: true }];
    expect(findMisleadingCharts({ ...baseContext, snapshot: snapshot({ chartMarkers }) })).toEqual([]);
  });
});
