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

  // Regression guard for Jason's review feedback: the chart must be financially interpretable —
  // every bar's dollar value must be printed directly (not only readable via hover/tooltip, and
  // not only summarized once for the whole chart) so it's accessible with no interaction at all.
  it("prints every single month's dollar value directly under its own bar, not only in an aggregate summary", () => {
    const series = [
      { month: "2026-03", collectedCents: 130000 },
      { month: "2026-04", collectedCents: 140000 },
      { month: "2026-05", collectedCents: 160000 },
      { month: "2026-06", collectedCents: 140000 },
      { month: "2026-07", collectedCents: 150000 },
      { month: "2026-08", collectedCents: 175000 },
    ];
    const markup = renderToStaticMarkup(<ForgeMonthlyTrendChart series={series} formatValue={(c) => `$${(c / 100).toFixed(2)}`} />);
    for (const point of series) {
      expect(markup).toContain(`$${(point.collectedCents / 100).toFixed(2)}`);
    }
  });

  it("gives every bar a stable data attribute so its exact value can be targeted directly, without relying on hover state", () => {
    const series = [
      { month: "2026-07", collectedCents: 100000 },
      { month: "2026-08", collectedCents: 200000 },
    ];
    const markup = renderToStaticMarkup(<ForgeMonthlyTrendChart series={series} formatValue={(c) => `$${(c / 100).toFixed(2)}`} />);
    expect(markup).toContain('data-trend-bar="2026-07"');
    expect(markup).toContain('data-trend-bar="2026-08"');
    expect(markup).toContain("data-trend-bar-value");
  });

  it("groups the chart with an accessible name instead of relying on a single opaque role=\"img\" summary", () => {
    const series = [{ month: "2026-08", collectedCents: 175000 }];
    const markup = renderToStaticMarkup(<ForgeMonthlyTrendChart series={series} title="Collected per month" />);
    expect(markup).toContain('role="group"');
    expect(markup).toContain('aria-label="Collected per month"');
  });

  // Regression guard: monthLabel builds its date with Date.UTC but must format it in UTC too — a
  // server running in a timezone behind UTC (true for every US timezone) will otherwise roll the
  // 1st of the month back into the previous month and mislabel every bar (e.g. "2026-07" shows as
  // "Jun"). This is independent of the local machine's timezone at test time.
  it("labels every month correctly regardless of the server's local timezone", () => {
    const series = [
      { month: "2026-01", collectedCents: 100000 }, { month: "2026-02", collectedCents: 100000 },
      { month: "2026-03", collectedCents: 100000 }, { month: "2026-07", collectedCents: 100000 },
      { month: "2026-12", collectedCents: 100000 },
    ];
    const markup = renderToStaticMarkup(<ForgeMonthlyTrendChart series={series} />);
    expect(markup).toContain("Jan");
    expect(markup).toContain("Feb");
    expect(markup).toContain("Mar");
    expect(markup).toContain("Jul");
    // last entry renders as currentMonthLabel ("This month"), not "Dec" — covered by the
    // "labels the final bar as the current month" test above; here we only check non-final months.
  });
});
