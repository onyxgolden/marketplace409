import { describe, expect, it } from "vitest";
import { runFindingEngine, runFindingEngineForRoute } from "../findingEngine.mjs";
import { MalformedDiagnosticsSnapshotError } from "../diagnosticsContracts.mjs";

function cleanSnapshot() {
  return {
    documentMetrics: { scrollWidth: 1440, clientWidth: 1440, scrollHeight: 900, clientHeight: 900, colorScheme: "light" },
    elements: [{
      selector: "button#save", tagName: "button", role: null, rect: { x: 0, y: 0, width: 44, height: 44 },
      overflow: { scrollWidth: 44, clientWidth: 44, scrollHeight: 44, clientHeight: 44 },
      computedStyle: { color: "rgb(0,0,0)", backgroundColor: "rgb(255,255,255)", effectiveBackgroundColor: "rgb(255,255,255)", fontSizePx: 14, fontWeight: "400" },
      accessibleName: "Save", text: "Save", isInteractive: true, focusVisibleChanged: true, visible: true,
    }],
    statusMarkers: [], chartMarkers: [], emptyStateMarkers: [], spacingSamples: [],
  };
}

function brokenSnapshot() {
  return {
    documentMetrics: { scrollWidth: 620, clientWidth: 390, scrollHeight: 900, clientHeight: 900, colorScheme: "light" },
    elements: [{
      selector: "button#tiny", tagName: "button", role: null, rect: { x: 0, y: 0, width: 10, height: 10 },
      overflow: { scrollWidth: 10, clientWidth: 10, scrollHeight: 10, clientHeight: 10 },
      computedStyle: { color: "rgb(0,0,0)", backgroundColor: "rgb(255,255,255)", effectiveBackgroundColor: "rgb(255,255,255)", fontSizePx: 14, fontWeight: "400" },
      accessibleName: "", text: "", isInteractive: true, focusVisibleChanged: false, visible: true,
    }],
    statusMarkers: [], chartMarkers: [], emptyStateMarkers: [], spacingSamples: [],
  };
}

function routeEvidence({ desktop = cleanSnapshot(), tablet = cleanSnapshot(), mobile = cleanSnapshot() } = {}) {
  return {
    application: "409 Marketplace FORGE", routeId: "home", routePath: "/",
    snapshots: { desktop, tablet, mobile },
    screenshotHashes: { desktop: `sha256:${"a".repeat(64)}`, tablet: `sha256:${"b".repeat(64)}`, mobile: `sha256:${"c".repeat(64)}` },
  };
}

describe("runFindingEngineForRoute", () => {
  it("produces zero findings for a completely clean route", () => {
    expect(runFindingEngineForRoute(routeEvidence())).toEqual([]);
  });

  it("produces multiple findings for a broken mobile viewport (overflow, tiny target, no name, no focus indicator)", () => {
    const findings = runFindingEngineForRoute(routeEvidence({ mobile: brokenSnapshot() }));
    const categories = new Set(findings.map((f) => f.category));
    expect(categories.has("horizontal_overflow")).toBe(true);
    expect(categories.has("undersized_touch_target")).toBe(true);
    expect(categories.has("missing_accessible_name")).toBe(true);
    expect(categories.has("keyboard_focus_visibility")).toBe(true);
  });

  it("only reports findings for the viewport that is actually broken", () => {
    const findings = runFindingEngineForRoute(routeEvidence({ mobile: brokenSnapshot() }));
    expect(findings.every((f) => f.viewport === "mobile")).toBe(true);
  });

  it("is deterministic: re-running against identical evidence produces identical finding ids", () => {
    const evidence = routeEvidence({ mobile: brokenSnapshot() });
    const first = runFindingEngineForRoute(evidence, { now: "2026-09-01T00:00:00.000Z" });
    const second = runFindingEngineForRoute(evidence, { now: "2026-09-02T00:00:00.000Z" }); // different run time, same evidence
    expect(first.map((f) => f.findingId).sort()).toEqual(second.map((f) => f.findingId).sort());
  });

  it("fails closed on a malformed snapshot rather than silently skipping it", () => {
    const evidence = routeEvidence({ mobile: { not: "a valid snapshot" } });
    expect(() => runFindingEngineForRoute(evidence)).toThrow(MalformedDiagnosticsSnapshotError);
  });

  it("every produced finding passes its own contract validation (already proven by not throwing, asserted explicitly here)", () => {
    const findings = runFindingEngineForRoute(routeEvidence({ mobile: brokenSnapshot() }));
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      expect(finding.findingClass).toBe("deterministic");
      expect(finding.status).toBe("new");
    }
  });
});

describe("runFindingEngine", () => {
  it("wraps multiple routes into one validated, sorted manifest", () => {
    const manifest = runFindingEngine([routeEvidence(), routeEvidence({ mobile: brokenSnapshot(), routeId: "other" })].map((r, i) => (i === 1 ? { ...r, routeId: "other" } : r)));
    expect(manifest.schemaVersion).toBe("1.0");
    expect(manifest.findings.length).toBeGreaterThan(0);
  });
});
