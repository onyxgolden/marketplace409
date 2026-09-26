// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ForgeCategoryDonutChart from "./ForgeCategoryDonutChart.jsx";

let mounted = null;
function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(ui); });
  mounted = { container, root };
  return mounted;
}
afterEach(() => {
  if (mounted) {
    act(() => { mounted.root.unmount(); });
    mounted.container.remove();
    mounted = null;
  }
});

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

  it("without onSelectSlice, legend rows are plain (not buttons) and slices carry no click affordance -- unchanged from before click support existed", () => {
    const slices = [{ key: "a", label: "A", valueCents: 100 }];
    const { container } = mount(<ForgeCategoryDonutChart title="Expenses by category" slices={slices} formatValue={money} />);
    expect(container.querySelector('[data-donut-legend-row="a"] button')).toBeNull();
    expect(container.querySelector('[data-donut-slice="a"]').getAttribute("role")).toBeNull();
  });

  it("with onSelectSlice, clicking the legend row or the arc calls back with that slice", () => {
    const slices = [
      { key: "a", label: "A", valueCents: 500 },
      { key: "b", label: "B", valueCents: 300 },
    ];
    const onSelectSlice = vi.fn();
    const { container } = mount(<ForgeCategoryDonutChart title="Expenses by category" slices={slices} formatValue={money} onSelectSlice={onSelectSlice} />);

    const legendButton = container.querySelector('[data-donut-legend-row="a"] button');
    expect(legendButton).not.toBeNull();
    act(() => { legendButton.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(onSelectSlice).toHaveBeenCalledTimes(1);
    expect(onSelectSlice.mock.calls[0][0]).toMatchObject({ key: "a", label: "A", valueCents: 500 });

    const arc = container.querySelector('[data-donut-slice="b"]');
    expect(arc.getAttribute("role")).toBe("button");
    act(() => { arc.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(onSelectSlice).toHaveBeenCalledTimes(2);
    expect(onSelectSlice.mock.calls[1][0]).toMatchObject({ key: "b", label: "B", valueCents: 300 });
  });

  it("with onSelectSlice, Enter and Space on the arc also trigger the callback (keyboard access)", () => {
    const slices = [{ key: "a", label: "A", valueCents: 500 }];
    const onSelectSlice = vi.fn();
    const { container } = mount(<ForgeCategoryDonutChart title="Expenses by category" slices={slices} formatValue={money} onSelectSlice={onSelectSlice} />);
    const arc = container.querySelector('[data-donut-slice="a"]');
    act(() => { arc.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
    act(() => { arc.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true })); });
    expect(onSelectSlice).toHaveBeenCalledTimes(2);
  });

  it("decorative center text never intercepts chart clicks (pointer-events none)", () => {
    const slices = [{ key: "a", label: "A", valueCents: 500 }];
    const { container } = mount(<ForgeCategoryDonutChart title="Expenses by category" slices={slices} formatValue={money} />);
    const texts = [...container.querySelectorAll("svg text")];
    expect(texts.length).toBeGreaterThan(0);
    texts.forEach((text) => {
      expect(text.style.pointerEvents).toBe("none");
    });
  });
});
