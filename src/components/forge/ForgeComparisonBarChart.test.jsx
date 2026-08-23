// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import ForgeComparisonBarChart from "./ForgeComparisonBarChart.jsx";

const dollars = (cents) => `$${(cents / 100).toFixed(2)}`;

function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(ui); });
  return { container, root };
}
function unmount({ container, root }) {
  act(() => { root.unmount(); });
  container.remove();
}

// The zero line is the gridline with the bolder stroke (stroke-slate-400) — the other four
// gridlines (two above, two below) use the lighter stroke-slate-200.
function findZeroY(markup) {
  const zeroLine = markup.match(/<line x1="52" x2="712" y1="([\d.]+)" y2="\1" class="stroke-slate-400[^"]*"/);
  return Number(zeroLine[1]);
}

describe("ForgeComparisonBarChart — zero-axis structure", () => {
  it("renders a truthful empty state instead of a fabricated chart when every period is zero", () => {
    const series = [{ key: "2026-08", primaryCents: 0, secondaryCents: 0 }];
    const markup = renderToStaticMarkup(<ForgeComparisonBarChart series={series} formatValue={dollars} />);
    expect(markup).toContain("No recorded activity yet for this period.");
  });

  it("draws the collected bar entirely above the zero line", () => {
    const series = [{ key: "2026-08", primaryCents: 175000, secondaryCents: 42500 }];
    const markup = renderToStaticMarkup(<ForgeComparisonBarChart series={series} formatValue={dollars} />);
    const bar = markup.match(/<rect data-comparison-bar="primary"[^>]*>/)[0];
    const y = Number(bar.match(/\sy="([\d.]+)"/)[1]);
    const height = Number(bar.match(/\sheight="([\d.]+)"/)[1]);
    const zeroY = findZeroY(markup);
    expect(y).toBeLessThan(zeroY);
    expect(y + height).toBeCloseTo(zeroY, 1);
  });

  it("draws the expense bar starting exactly at the zero line and extending downward", () => {
    const series = [{ key: "2026-08", primaryCents: 175000, secondaryCents: 42500 }];
    const markup = renderToStaticMarkup(<ForgeComparisonBarChart series={series} formatValue={dollars} />);
    const bar = markup.match(/<rect data-comparison-bar="secondary"[^>]*>/)[0];
    const y = Number(bar.match(/\sy="([\d.]+)"/)[1]);
    const height = Number(bar.match(/\sheight="([\d.]+)"/)[1]);
    const zeroY = findZeroY(markup);
    expect(y).toBeCloseTo(zeroY, 1);
    expect(height).toBeGreaterThan(0);
  });

  it("plots the net line point between the collected top and the zero line when collected exceeds expenses", () => {
    const series = [{ key: "2026-08", primaryCents: 175000, secondaryCents: 42500 }];
    const markup = renderToStaticMarkup(<ForgeComparisonBarChart series={series} formatValue={dollars} />);
    const primaryBar = markup.match(/<rect data-comparison-bar="primary"[^>]*>/)[0];
    const collectedTop = Number(primaryBar.match(/\sy="([\d.]+)"/)[1]);
    const circle = markup.match(/<circle[^>]*>/)[0];
    const netY = Number(circle.match(/\scy="([\d.]+)"/)[1]);
    const zeroY = findZeroY(markup);
    // net = 175000 - 42500 = 132500, strictly between the full-collected top and zero
    expect(netY).toBeGreaterThan(collectedTop);
    expect(netY).toBeLessThan(zeroY);
  });

  it("plots the net line point below the zero line when expenses exceed collections", () => {
    const series = [{ key: "2026-08", primaryCents: 40000, secondaryCents: 100000 }];
    const markup = renderToStaticMarkup(<ForgeComparisonBarChart series={series} formatValue={dollars} />);
    const circle = markup.match(/<circle[^>]*>/)[0];
    const netY = Number(circle.match(/\scy="([\d.]+)"/)[1]);
    const zeroY = findZeroY(markup);
    expect(netY).toBeGreaterThan(zeroY);
  });

  it("never permanently prints a visible full-precision dollar amount on the chart body itself — only compact axis labels are visible; exact values live in the tooltip (aria-label) and accessible table", () => {
    const series = [{ key: "2026-08", primaryCents: 175000, secondaryCents: 42500 }];
    const markup = renderToStaticMarkup(<ForgeComparisonBarChart series={series} formatValue={dollars} />);
    const visibleTextNodes = markup.match(/<text[^>]*>([^<]*)<\/text>/g) || [];
    expect(visibleTextNodes.some((node) => node.includes("$1750.00"))).toBe(false);
    expect(visibleTextNodes.some((node) => node.includes("$425.00"))).toBe(false);
    // the full-precision value is still available non-visually via the target's aria-label
    expect(markup).toContain("Primary $1750.00");
    // and in the screen-reader-only table
    const tableMarkup = markup.slice(markup.indexOf("<table"));
    expect(tableMarkup).toContain("$1750.00");
  });
});

describe("ForgeComparisonBarChart — vertical scale and legend", () => {
  it("renders a readable vertical dollar scale with a zero gridline", () => {
    const series = [{ key: "2026-08", primaryCents: 175000, secondaryCents: 42500 }];
    const markup = renderToStaticMarkup(<ForgeComparisonBarChart series={series} formatValue={dollars} />);
    expect(markup).toContain("$0");
    expect((markup.match(/<line /g) || []).length).toBeGreaterThanOrEqual(5);
  });

  it("shows a visible legend naming both bar series and the net line", () => {
    const series = [{ key: "2026-08", primaryCents: 100000, secondaryCents: 40000 }];
    const markup = renderToStaticMarkup(<ForgeComparisonBarChart series={series} formatValue={dollars} primaryLabel="Rent collected" secondaryLabel="Rental operating expenses" netLabel="Net cash flow" />);
    expect(markup).toContain("Rent collected");
    expect(markup).toContain("Rental operating expenses");
    expect(markup).toContain("Net cash flow");
  });
});

describe("ForgeComparisonBarChart — accessible table", () => {
  it("lists every period's exact collected, expense, and net values in a screen-reader table", () => {
    const series = [
      { key: "2026-07", primaryCents: 100000, secondaryCents: 30000 },
      { key: "2026-08", primaryCents: 200000, secondaryCents: 50000 },
    ];
    const markup = renderToStaticMarkup(<ForgeComparisonBarChart series={series} formatValue={dollars} />);
    expect(markup).toContain("$1000.00");
    expect(markup).toContain("$300.00");
    expect(markup).toContain("$700.00"); // net for July: 1000-300
    expect(markup).toContain("$2000.00");
    expect(markup).toContain("$500.00");
    expect(markup).toContain("$1500.00"); // net for August: 2000-500
  });

  it("presents a negative net value with a minus sign in the accessible table, never a fabricated positive", () => {
    const series = [{ key: "2026-08", primaryCents: 40000, secondaryCents: 100000 }];
    const markup = renderToStaticMarkup(<ForgeComparisonBarChart series={series} formatValue={dollars} />);
    expect(markup).toMatch(/<td>-\$600\.00<\/td>/);
  });

  // Regression guard: a <table> under default table-layout:auto ignores an explicit small width
  // and sizes to its content, so applying "sr-only" directly to the <table> never actually clips
  // it — the real multi-column table leaked into the page's horizontally scrollable area. The fix
  // wraps the table in a sr-only <div>, which is not subject to table auto-layout sizing.
  it("wraps the accessible table in a sr-only container rather than applying sr-only to the table itself", () => {
    const series = [{ key: "2026-08", primaryCents: 175000, secondaryCents: 42500 }];
    const markup = renderToStaticMarkup(<ForgeComparisonBarChart series={series} formatValue={dollars} />);
    expect(markup).toMatch(/<div class="sr-only"><table>/);
    expect(markup).not.toMatch(/<table class="sr-only">/);
  });
});

describe("ForgeComparisonBarChart — hover and keyboard-focus tooltip", () => {
  let mounted;
  afterEach(() => { if (mounted) { unmount(mounted); mounted = null; } });

  const series = [
    { key: "2026-07", primaryCents: 100000, secondaryCents: 30000 },
    { key: "2026-08", primaryCents: 200000, secondaryCents: 50000 },
  ];

  it("shows no tooltip until a period is hovered or focused", () => {
    mounted = mount(<ForgeComparisonBarChart series={series} formatValue={dollars} />);
    expect(mounted.container.querySelector("[data-comparison-tooltip]")).toBeNull();
  });

  it("reveals the exact period/collected/expenses/net values in a tooltip on keyboard focus", () => {
    mounted = mount(<ForgeComparisonBarChart series={series} formatValue={dollars} />);
    const target = mounted.container.querySelector('[data-comparison-target="2026-08"]');
    // React 17+ delegates onFocus/onBlur via native focusin/focusout listeners (focus/blur don't
    // bubble at all, even synthetically) — dispatch the events React actually listens for.
    act(() => { target.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); });
    const tooltip = mounted.container.querySelector("[data-comparison-tooltip]");
    expect(tooltip).toBeTruthy();
    expect(tooltip.textContent).toContain("$2000.00");
    expect(tooltip.textContent).toContain("$500.00");
    expect(tooltip.textContent).toContain("$1500.00");
  });

  it("hides the tooltip again on blur", () => {
    mounted = mount(<ForgeComparisonBarChart series={series} formatValue={dollars} />);
    const target = mounted.container.querySelector('[data-comparison-target="2026-08"]');
    act(() => { target.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); });
    expect(mounted.container.querySelector("[data-comparison-tooltip]")).toBeTruthy();
    act(() => { target.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    expect(mounted.container.querySelector("[data-comparison-tooltip]")).toBeNull();
  });

  it("also reveals the tooltip on a click, so touch devices without hover can still see exact values", () => {
    mounted = mount(<ForgeComparisonBarChart series={series} formatValue={dollars} />);
    const target = mounted.container.querySelector('[data-comparison-target="2026-07"]');
    act(() => { target.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const tooltip = mounted.container.querySelector("[data-comparison-tooltip]");
    expect(tooltip.textContent).toContain("$1000.00");
  });

  it("gives every focus target a full descriptive accessible name even without the visual tooltip open", () => {
    mounted = mount(<ForgeComparisonBarChart series={series} formatValue={dollars} primaryLabel="Rent collected" secondaryLabel="Rental operating expenses" netLabel="Net cash flow" />);
    const target = mounted.container.querySelector('[data-comparison-target="2026-08"]');
    expect(target.getAttribute("aria-label")).toContain("August 2026");
    expect(target.getAttribute("aria-label")).toContain("Rent collected $2000.00");
    expect(target.getAttribute("aria-label")).toContain("Rental operating expenses $500.00");
    expect(target.getAttribute("aria-label")).toContain("Net cash flow $1500.00");
  });
});

describe("ForgeComparisonBarChart — responsive overflow behavior", () => {
  it("never marks the chart as scrollable for six months of data", () => {
    const series = Array.from({ length: 6 }, (_, i) => ({ key: `2026-0${i + 1}`, primaryCents: 100000, secondaryCents: 20000 }));
    const markup = renderToStaticMarkup(<ForgeComparisonBarChart series={series} formatValue={dollars} />);
    expect(markup).toContain('data-chart-scrollable="false"');
  });

  it("never marks the chart as scrollable for a full twelve-month year view", () => {
    const series = Array.from({ length: 12 }, (_, i) => ({ key: `2026-${String(i + 1).padStart(2, "0")}`, primaryCents: 100000, secondaryCents: 20000 }));
    const markup = renderToStaticMarkup(<ForgeComparisonBarChart series={series} formatValue={dollars} />);
    expect(markup).toContain('data-chart-scrollable="false"');
  });

  it("only allows scrolling once an all-time yearly series grows large enough to genuinely need it", () => {
    const series = Array.from({ length: 16 }, (_, i) => ({ key: String(2010 + i), primaryCents: 100000, secondaryCents: 20000 }));
    const markup = renderToStaticMarkup(<ForgeComparisonBarChart series={series} formatValue={dollars} />);
    expect(markup).toContain('data-chart-scrollable="true"');
  });
});

describe("ForgeComparisonBarChart — metallic treatment", () => {
  it("fills collected and expense bars with the shared metallic gradients, not a flat color", () => {
    const series = [{ key: "2026-08", primaryCents: 175000, secondaryCents: 42500 }];
    const markup = renderToStaticMarkup(<ForgeComparisonBarChart series={series} formatValue={dollars} />);
    const primaryBar = markup.match(/<rect data-comparison-bar="primary"[^>]*>/)[0];
    const secondaryBar = markup.match(/<rect data-comparison-bar="secondary"[^>]*>/)[0];
    expect(primaryBar).toMatch(/fill="url\(#[\w-]*forge-metal-income\)"/);
    expect(secondaryBar).toMatch(/fill="url\(#[\w-]*forge-metal-expense\)"/);
  });

  it("gives every bar a thin machined-edge stroke instead of a drop-shadow or blur filter", () => {
    const series = [{ key: "2026-08", primaryCents: 175000, secondaryCents: 42500 }];
    const markup = renderToStaticMarkup(<ForgeComparisonBarChart series={series} formatValue={dollars} />);
    expect(markup).not.toContain("filter:");
    expect(markup).not.toContain("<filter");
    expect(markup).not.toContain("backdrop-blur");
    const primaryBar = markup.match(/<rect data-comparison-bar="primary"[^>]*>/)[0];
    expect(primaryBar).toContain('stroke="var(--forge-metal-income-lo)"');
  });

  it("gives the net line and its point markers a polished-metal gradient treatment", () => {
    const series = [{ key: "2026-08", primaryCents: 175000, secondaryCents: 42500 }];
    const markup = renderToStaticMarkup(<ForgeComparisonBarChart series={series} formatValue={dollars} />);
    expect(markup).toMatch(/<polyline[^>]*stroke="url\(#[\w-]*forge-metal-net-line\)"/);
    expect(markup).toMatch(/<circle[^>]*fill="url\(#[\w-]*forge-metal-net-dot\)"/);
  });

  it("scopes gradient ids to this chart instance so two charts on the same page never collide", () => {
    // useId() only guarantees uniqueness within one render tree — exercise that real scenario by
    // mounting two instances as siblings under one root, the way two charts would actually share a page.
    const series = [{ key: "2026-08", primaryCents: 100000, secondaryCents: 20000 }];
    const markup = renderToStaticMarkup(
      <div>
        <ForgeComparisonBarChart series={series} formatValue={dollars} />
        <ForgeComparisonBarChart series={series} formatValue={dollars} />
      </div>,
    );
    const ids = [...markup.matchAll(/<linearGradient id="([\w-]*forge-metal-income)"/g)].map((match) => match[1]);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("never applies a metallic gradient to body text — axis labels, month labels, and legend text stay flat solid colors", () => {
    const series = [{ key: "2026-08", primaryCents: 175000, secondaryCents: 42500 }];
    const markup = renderToStaticMarkup(<ForgeComparisonBarChart series={series} formatValue={dollars} />);
    const textNodes = markup.match(/<text[^>]*class="([^"]*)"[^>]*>/g) || [];
    textNodes.forEach((node) => {
      expect(node).not.toContain("url(#");
      expect(node).toMatch(/fill-(slate|sky)-/);
    });
  });

  it("applies the shared metallic token classes to the chart root so the gradients are theme-aware in both light and dark mode", () => {
    const series = [{ key: "2026-08", primaryCents: 100000, secondaryCents: 20000 }];
    const markup = renderToStaticMarkup(<ForgeComparisonBarChart series={series} formatValue={dollars} />);
    const root = markup.match(/<div data-comparison-chart="true" class="([^"]*)"/)[1];
    expect(root).toContain("--forge-metal-income-hi");
    expect(root).toContain("dark:[--forge-metal-income-hi");
  });
});

describe("ForgeComparisonBarChart — yearly labels", () => {
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
