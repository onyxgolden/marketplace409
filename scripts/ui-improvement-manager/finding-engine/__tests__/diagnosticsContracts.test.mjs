import { describe, expect, it } from "vitest";
import { MalformedDiagnosticsSnapshotError, validateDiagnosticsSnapshot } from "../diagnosticsContracts.mjs";

function validSnapshot(overrides = {}) {
  return {
    documentMetrics: { scrollWidth: 1440, clientWidth: 1440, scrollHeight: 900, clientHeight: 900, colorScheme: "light" },
    elements: [{
      selector: "button#save", tagName: "button", role: null, rect: { x: 0, y: 0, width: 100, height: 40 },
      overflow: { scrollWidth: 100, clientWidth: 100, scrollHeight: 40, clientHeight: 40 },
      computedStyle: { color: "rgb(0,0,0)", backgroundColor: "rgb(255,255,255)" },
      accessibleName: "Save", text: "Save", isInteractive: true, focusVisibleChanged: true, visible: true,
    }],
    statusMarkers: [], chartMarkers: [], emptyStateMarkers: [], spacingSamples: [],
    ...overrides,
  };
}

describe("validateDiagnosticsSnapshot", () => {
  it("accepts a well-formed snapshot", () => {
    const result = validateDiagnosticsSnapshot(validSnapshot());
    expect(result.elements).toHaveLength(1);
    expect(result.documentMetrics.colorScheme).toBe("light");
  });

  it("rejects a missing documentMetrics field", () => {
    const snapshot = validSnapshot();
    delete snapshot.documentMetrics.clientWidth;
    expect(() => validateDiagnosticsSnapshot(snapshot)).toThrow(MalformedDiagnosticsSnapshotError);
  });

  it("rejects an invalid colorScheme value", () => {
    expect(() => validateDiagnosticsSnapshot(validSnapshot({ documentMetrics: { ...validSnapshot().documentMetrics, colorScheme: "rainbow" } })))
      .toThrow(/colorScheme/);
  });

  it("rejects elements that are not an array", () => {
    expect(() => validateDiagnosticsSnapshot(validSnapshot({ elements: "nope" }))).toThrow(/elements must be an array/);
  });

  it("rejects an element missing a selector", () => {
    const snapshot = validSnapshot();
    delete snapshot.elements[0].selector;
    expect(() => validateDiagnosticsSnapshot(snapshot)).toThrow(/selector/);
  });

  it("rejects an element with a non-numeric rect", () => {
    const snapshot = validSnapshot();
    snapshot.elements[0].rect.width = "wide";
    expect(() => validateDiagnosticsSnapshot(snapshot)).toThrow(/rect/);
  });

  it("returns frozen output", () => {
    const result = validateDiagnosticsSnapshot(validSnapshot());
    expect(() => { result.elements[0].selector = "hacked"; }).toThrow();
  });
});
