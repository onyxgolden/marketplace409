// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ForgeCategoryDonutChart from "./ForgeCategoryDonutChart.jsx";

const money = (cents) => `$${(cents / 100).toFixed(2)}`;

describe("ForgeCategoryDonutChart", () => {
  it("renders a truthful empty state instead of a fabricated ring when there is no activity", () => {
    const markup = renderToStaticMarkup(<ForgeCategoryDonutChart title="Income by category" slices={[]} formatValue={money} />);
    expect(markup).toContain("No activity in this period.");
    expect(markup).not.toContain("role=\"img\"");
  });

  it("computes each slice's percentage from the caller's own values, never a fabricated share", () => {
    const slices = [
      { key: "rental_income", label: "Rental Income", valueCents: 75000 },
      { key: "business_income", label: "Business Income", valueCents: 25000 },
    ];
    const markup = renderToStaticMarkup(<ForgeCategoryDonutChart title="Income by category" slices={slices} formatValue={money} />);
    expect(markup).toContain("Rental Income");
    expect(markup).toContain("$750.00");
    expect(markup).toContain("75%");
    expect(markup).toContain("Business Income");
    expect(markup).toContain("$250.00");
    expect(markup).toContain("25%");
    expect(markup).toContain("$1000.00"); // center total
  });

  it("one SVG arc per slice, one legend row per slice, in the same fixed order", () => {
    const slices = [
      { key: "a", label: "A", valueCents: 500 },
      { key: "b", label: "B", valueCents: 300 },
      { key: "c", label: "C", valueCents: 200 },
    ];
    const markup = renderToStaticMarkup(<ForgeCategoryDonutChart title="Expenses by category" slices={slices} formatValue={money} />);
    expect((markup.match(/data-donut-slice=/g) || []).length).toBe(3);
    expect((markup.match(/data-donut-legend-row=/g) || []).length).toBe(3);
    const sliceOrder = [...markup.matchAll(/data-donut-slice="([^"]+)"/g)].map((match) => match[1]);
    const legendOrder = [...markup.matchAll(/data-donut-legend-row="([^"]+)"/g)].map((match) => match[1]);
    expect(sliceOrder).toEqual(["a", "b", "c"]);
    expect(legendOrder).toEqual(["a", "b", "c"]);
  });

  it("assigns categorical colors from the fixed, validated palette order — never the same slot to two slices", () => {
    const slices = [
      { key: "a", label: "A", valueCents: 100 },
      { key: "b", label: "B", valueCents: 100 },
      { key: "c", label: "C", valueCents: 100 },
    ];
    const markup = renderToStaticMarkup(<ForgeCategoryDonutChart title="Expenses by category" slices={slices} formatValue={money} />);
    const colors = [...markup.matchAll(/stroke="(var\(--forge-cat-\d\)\S*?)"/g)].map((match) => match[1]);
    expect(colors).toEqual(["var(--forge-cat-1)", "var(--forge-cat-2)", "var(--forge-cat-3)"]);
  });
});
