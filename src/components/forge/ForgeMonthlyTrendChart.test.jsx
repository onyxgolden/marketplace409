// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ForgeMonthlyTrendChart from "./ForgeMonthlyTrendChart.jsx";

describe("ForgeMonthlyTrendChart", () => {
  it("renders a truthful empty state instead of a fabricated chart when every month is zero", () => {
    const series = [{ month: "2026-08", collectedCents: 0 }];
    const markup = renderToStaticMarkup(<ForgeMonthlyTrendChart series={series} />);
    expect(markup).toContain("No recorded collections yet for this period.");
    expect(markup).not.toContain("role=\"img\"");
  });

  it("never renders a fabricated comparison percentage or trend claim — only the caller's own values", () => {
    const series = [
      { month: "2026-07", collectedCents: 100000 },
      { month: "2026-08", collectedCents: 200000 },
    ];
    const markup = renderToStaticMarkup(<ForgeMonthlyTrendChart series={series} formatValue={(c) => `$${(c / 100).toFixed(2)}`} />);
    expect(markup).toContain("$1000.00");
    expect(markup).toContain("$2000.00");
    expect(markup).not.toMatch(/%\s*(up|down|increase|decrease)/i);
  });

  it("labels the final bar as the current month rather than a calendar abbreviation", () => {
    const series = [
      { month: "2026-07", collectedCents: 100000 },
      { month: "2026-08", collectedCents: 200000 },
    ];
    const markup = renderToStaticMarkup(<ForgeMonthlyTrendChart series={series} currentMonthLabel="This month" />);
    expect(markup).toContain("This month");
    expect(markup).toContain("Jul");
  });
});
