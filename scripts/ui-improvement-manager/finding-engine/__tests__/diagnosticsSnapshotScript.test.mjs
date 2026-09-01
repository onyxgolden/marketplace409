import { describe, expect, it } from "vitest";
import {
  CHART_MARKER_ATTRIBUTE, EMPTY_STATE_MARKER_ATTRIBUTE, INTERACTIVE_SELECTOR, MINIMUM_TOUCH_TARGET_PX,
  SPACING_GROUP_ATTRIBUTE, STATUS_SELECTOR, buildDiagnosticsCaptureScript,
} from "../diagnosticsSnapshotScript.mjs";

describe("buildDiagnosticsCaptureScript", () => {
  it("is valid, self-invoking JavaScript source", () => {
    expect(() => new Function(buildDiagnosticsCaptureScript())).not.toThrow();
  });

  it("embeds the interactive selector, status selector, and every opt-in marker attribute", () => {
    const script = buildDiagnosticsCaptureScript();
    // Embedded via JSON.stringify, so a selector containing quotes comes through escaped -- compare
    // against the same JSON.stringify output rather than the raw selector string.
    expect(script).toContain(JSON.stringify(INTERACTIVE_SELECTOR));
    expect(script).toContain(JSON.stringify(STATUS_SELECTOR));
    expect(script).toContain(CHART_MARKER_ATTRIBUTE);
    expect(script).toContain(EMPTY_STATE_MARKER_ATTRIBUTE);
    expect(script).toContain(SPACING_GROUP_ATTRIBUTE);
  });

  it("caps the touch-target constant at the WCAG 2.5.8 AA minimum, not an arbitrary number", () => {
    expect(MINIMUM_TOUCH_TARGET_PX).toBe(24);
  });

  it("returns an object literal shape with the six top-level snapshot fields", () => {
    const script = buildDiagnosticsCaptureScript();
    for (const field of ["documentMetrics", "elements", "statusMarkers", "chartMarkers", "emptyStateMarkers", "spacingSamples"]) {
      expect(script).toContain(field);
    }
  });
});
