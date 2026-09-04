import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import HealthVitalsTrendChart from "./HealthVitalsTrendChart";

describe("HealthVitalsTrendChart", () => {
  it("renders a single-series vitals trend with one y-axis and no legend box", () => {
    const markup = renderToStaticMarkup(<HealthVitalsTrendChart title="Steps" unit="steps" points={[
      { id: "a", measured_at: "2026-08-01T00:00:00.000Z", value_numeric: 6200 },
      { id: "b", measured_at: "2026-08-15T00:00:00.000Z", value_numeric: 9100 },
    ]}/>);
    expect(markup).toContain("<svg");
    expect((markup.match(/<svg/g) || []).length).toBe(1);
    expect(markup).toContain("9100 steps");
  });

  it("renders both systolic and diastolic lines for blood pressure on one shared mmHg axis", () => {
    const markup = renderToStaticMarkup(<HealthVitalsTrendChart title="Blood pressure" unit="mmHg" primaryLabel="Systolic" secondaryLabel="Diastolic" points={[
      { id: "a", measured_at: "2026-08-01T00:00:00.000Z", value_numeric: 132, secondary_value_numeric: 84 },
      { id: "b", measured_at: "2026-08-15T00:00:00.000Z", value_numeric: 124, secondary_value_numeric: 79 },
    ]}/>);
    expect((markup.match(/<svg/g) || []).length).toBe(1);
    expect(markup).toContain("Systolic");
    expect(markup).toContain("Diastolic");
    expect(markup).toContain("124 mmHg");
    expect(markup).toContain("79 mmHg");
  });

  it("shows a single value instead of a fabricated trend line when only one entry is on file", () => {
    const markup = renderToStaticMarkup(<HealthVitalsTrendChart title="Weight" unit="lb" points={[
      { id: "a", measured_at: "2026-08-01T00:00:00.000Z", value_numeric: 188 },
    ]}/>);
    expect(markup).not.toContain("<svg");
    expect(markup).toContain("one entry on file");
    expect(markup).toContain("188 lb");
  });

  it("labels the y-axis with rounded clean numbers, not raw data values", () => {
    const markup = renderToStaticMarkup(<HealthVitalsTrendChart title="Heart rate" unit="bpm" points={[
      { id: "a", measured_at: "2026-08-01T00:00:00.000Z", value_numeric: 71 },
      { id: "b", measured_at: "2026-08-15T00:00:00.000Z", value_numeric: 63 },
    ]}/>);
    expect(markup).not.toMatch(/>71</);
    expect(markup).not.toMatch(/>63</);
  });
});
