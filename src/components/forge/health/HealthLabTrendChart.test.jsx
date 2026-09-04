import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import HealthLabTrendChart from "./HealthLabTrendChart";

describe("HealthLabTrendChart", () => {
  it("shows a plain current-value row for a marker with only one draw, no fabricated line", () => {
    const markup = renderToStaticMarkup(<HealthLabTrendChart markerName="Hemoglobin A1c" points={[
      { collected_on: "2026-08-10", value_numeric: 7.4, unit: "%", flag: "high" },
    ]}/>);
    expect(markup).toContain("Hemoglobin A1c");
    expect(markup).toContain("7.4");
    expect(markup).toContain("one result on file");
    expect(markup).not.toContain("<svg");
  });

  it("renders a line chart with a target band once two or more draws exist and a reference range was entered", () => {
    const markup = renderToStaticMarkup(<HealthLabTrendChart markerName="LDL cholesterol" points={[
      { collected_on: "2026-05-01", value_numeric: 140, unit: "mg/dL", flag: "high", reference_low: null, reference_high: 100 },
      { collected_on: "2026-08-10", value_numeric: 310, unit: "mg/dL", flag: "high", reference_low: null, reference_high: 100 },
    ]}/>);
    expect(markup).toContain("<svg");
    expect(markup).toContain("<polyline");
    expect(markup).toContain("<rect");
    expect(markup).toContain("Target: ≤100 mg/dL");
    expect(markup).toContain("May 1");
    expect(markup).toContain("Aug 10");
  });

  // Regression guard: a real lab report's reference ranges are usually one-sided ("Desirable <200",
  // "Desirable >39") rather than a low-high pair -- the band must still render on the open side of
  // the chart, not only when both bounds happen to be present. The first version of this component
  // required both bounds and silently drew nothing for either one-sided case; the label still said
  // "Target: ..." so this went unnoticed until checked against a real screenshot.
  it("renders a target band for a floor-only reference range (e.g. HDL > 39), not only when both bounds are set", () => {
    const markup = renderToStaticMarkup(<HealthLabTrendChart markerName="HDL cholesterol" points={[
      { collected_on: "2026-05-01", value_numeric: 59, unit: "mg/dL", flag: "normal", reference_low: 39, reference_high: null },
      { collected_on: "2026-08-10", value_numeric: 58, unit: "mg/dL", flag: "normal", reference_low: 39, reference_high: null },
    ]}/>);
    expect(markup).toContain("<rect");
    expect(markup).toContain("Target: ≥39 mg/dL");
  });

  it("never shows a target band when no reference range was entered at review time", () => {
    const markup = renderToStaticMarkup(<HealthLabTrendChart markerName="Glucose" points={[
      { collected_on: "2026-05-01", value_numeric: 100, unit: "mg/dL", flag: "normal", reference_low: null, reference_high: null },
      { collected_on: "2026-08-10", value_numeric: 147, unit: "mg/dL", flag: "high", reference_low: null, reference_high: null },
    ]}/>);
    expect(markup).not.toContain("Target:");
  });
});
