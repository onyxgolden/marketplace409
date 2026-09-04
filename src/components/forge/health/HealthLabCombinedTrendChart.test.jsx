import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import HealthLabCombinedTrendChart from "./HealthLabCombinedTrendChart";

describe("HealthLabCombinedTrendChart", () => {
  it("renders every real value as its own recorded unit -- never indexed to a percentage", () => {
    const markup = renderToStaticMarkup(<HealthLabCombinedTrendChart title="Wide-range markers" groupedLabs={{
      "Total cholesterol": [
        { id: "a", collected_on: "2026-05-08", value_numeric: 406, unit: "mg/dL", flag: "high" },
        { id: "b", collected_on: "2026-08-08", value_numeric: 271, unit: "mg/dL", flag: "high" },
      ],
      "LDL cholesterol": [
        { id: "c", collected_on: "2026-05-08", value_numeric: 310, unit: "mg/dL", flag: "high" },
        { id: "d", collected_on: "2026-08-08", value_numeric: 194, unit: "mg/dL", flag: "high" },
      ],
    }}/>);
    expect(markup).toContain("<svg");
    expect(markup).toContain("Total cholesterol");
    expect(markup).toContain("LDL cholesterol");
    expect(markup).toContain("271");
    expect(markup).toContain("194");
    expect(markup).not.toContain("100%");
    expect(markup).not.toContain("% of");
  });

  // Regression guard: the whole point of tiering by magnitude before reaching this component is
  // that one axis stays meaningful. This component itself has no opinion on tiers -- it just must
  // never invent a second y-scale for whatever series it's handed (see the dataviz skill's
  // documented anti-pattern: dual axes invent a correlation that isn't in the data).
  it("never renders more than one y-axis for the series it's given", () => {
    const markup = renderToStaticMarkup(<HealthLabCombinedTrendChart title="Narrow-range markers" groupedLabs={{
      "Hemoglobin A1c": [
        { id: "a", collected_on: "2026-05-08", value_numeric: 7.4, unit: "%", flag: "high" },
        { id: "b", collected_on: "2026-08-08", value_numeric: 5.8, unit: "%", flag: "high" },
      ],
      "Creatinine": [
        { id: "c", collected_on: "2026-05-08", value_numeric: 1.12, unit: "mg/dL", flag: "normal" },
        { id: "d", collected_on: "2026-08-08", value_numeric: 1.20, unit: "mg/dL", flag: "normal" },
      ],
    }}/>);
    const svgOpenTags = markup.match(/<svg/g) || [];
    expect(svgOpenTags.length).toBe(1);
  });

  it("notes a marker with only one draw instead of silently dropping it", () => {
    const markup = renderToStaticMarkup(<HealthLabCombinedTrendChart title="Wide-range markers" groupedLabs={{
      "Glucose": [
        { id: "a", collected_on: "2026-05-08", value_numeric: 147, unit: "mg/dL", flag: "high" },
        { id: "b", collected_on: "2026-08-08", value_numeric: 127, unit: "mg/dL", flag: "high" },
      ],
      "eGFR": [
        { id: "c", collected_on: "2026-05-08", value_numeric: 79, unit: "mL/min/1.73m²", flag: "normal" },
      ],
    }}/>);
    expect(markup).toContain("eGFR");
    expect(markup).toContain("Not enough history yet for a trend");
  });

  it("renders nothing when no marker in the group has a second draw yet", () => {
    const markup = renderToStaticMarkup(<HealthLabCombinedTrendChart title="Wide-range markers" groupedLabs={{
      "eGFR": [{ id: "a", collected_on: "2026-05-08", value_numeric: 79, unit: "mL/min/1.73m²", flag: "normal" }],
    }}/>);
    expect(markup).toBe("");
  });

  it("labels the y-axis with rounded clean numbers, not raw data values", () => {
    const markup = renderToStaticMarkup(<HealthLabCombinedTrendChart title="Wide-range markers" groupedLabs={{
      "Total cholesterol": [
        { id: "a", collected_on: "2026-05-08", value_numeric: 406, unit: "mg/dL", flag: "high" },
        { id: "b", collected_on: "2026-08-08", value_numeric: 271, unit: "mg/dL", flag: "high" },
      ],
    }}/>);
    // 406/271 with a quarter-span step should round to a clean multiple of 25/50/100, not e.g. "406".
    expect(markup).not.toMatch(/>406</);
    expect(markup).not.toMatch(/>271</);
  });
});
