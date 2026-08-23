// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ForgeComparisonBarChart from "./ForgeComparisonBarChart.jsx";

const dollars = (cents) => `$${(cents / 100).toFixed(2)}`;

describe("ForgeComparisonBarChart", () => {
  it("renders a truthful empty state instead of a fabricated chart when every period is zero", () => {
    const series = [{ key: "2026-08", primaryCents: 0, secondaryCents: 0 }];
    const markup = renderToStaticMarkup(<ForgeComparisonBarChart series={series} formatValue={dollars} />);
    expect(markup).toContain("No recorded activity yet for this period.");
  });

  it("shows a visible legend naming both series", () => {
    const series = [{ key: "2026-08", primaryCents: 100000, secondaryCents: 40000 }];
    const markup = renderToStaticMarkup(<ForgeComparisonBarChart series={series} formatValue={dollars} primaryLabel="Rent collected" secondaryLabel="Rental operating expenses" />);
    expect(markup).toContain('aria-label="Legend"');
    expect(markup).toContain("Rent collected");
    expect(markup).toContain("Rental operating expenses");
  });

  it("prints both series' exact dollar values directly, not only through a hover tooltip", () => {
    const series = [{ key: "2026-08", primaryCents: 175000, secondaryCents: 42500 }];
    const markup = renderToStaticMarkup(<ForgeComparisonBarChart series={series} formatValue={dollars} />);
    expect(markup).toContain("$1750.00");
    expect(markup).toContain("$425.00");
  });

  it("shows a positive net figure with the same distinct styling family, keyed for lookup", () => {
    const series = [{ key: "2026-08", primaryCents: 175000, secondaryCents: 42500 }];
    const markup = renderToStaticMarkup(<ForgeComparisonBarChart series={series} formatValue={dollars} />);
    expect(markup).toContain("data-comparison-net");
    expect(markup).toContain("$1325.00");
  });

  it("shows a negative net figure honestly with a minus sign, never a fabricated positive", () => {
    const series = [{ key: "2026-08", primaryCents: 40000, secondaryCents: 100000 }];
    const markup = renderToStaticMarkup(<ForgeComparisonBarChart series={series} formatValue={dollars} />);
    expect(markup).toMatch(/data-comparison-net[^>]*>-\$600\.00/);
  });

  it("tags every period with a stable data attribute for direct targeting", () => {
    const series = [
      { key: "2026-07", primaryCents: 100000, secondaryCents: 0 },
      { key: "2026-08", primaryCents: 200000, secondaryCents: 0 },
    ];
    const markup = renderToStaticMarkup(<ForgeComparisonBarChart series={series} formatValue={dollars} />);
    expect(markup).toContain('data-comparison-point="2026-07"');
    expect(markup).toContain('data-comparison-point="2026-08"');
  });

  it("labels yearly keys (four digits) as the bare year, not a month abbreviation", () => {
    const series = [{ key: "2025", primaryCents: 100000, secondaryCents: 0 }];
    const markup = renderToStaticMarkup(<ForgeComparisonBarChart series={series} formatValue={dollars} />);
    expect(markup).toContain(">2025<");
  });

  it("labels every month correctly regardless of the server's local timezone", () => {
    const series = [{ key: "2026-07", primaryCents: 100000, secondaryCents: 0 }];
    const markup = renderToStaticMarkup(<ForgeComparisonBarChart series={series} formatValue={dollars} />);
    expect(markup).toContain(">Jul<");
  });
});
