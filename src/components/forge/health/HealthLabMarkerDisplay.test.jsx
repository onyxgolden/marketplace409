// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import HealthLabMarkerDisplay from "./HealthLabMarkerDisplay";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function mount(point) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<HealthLabMarkerDisplay point={point} />));
  return { container, root };
}

function unmount(mounted) {
  act(() => mounted.root.unmount());
  mounted.container.remove();
}

function point(overrides) {
  return {
    id: "lab-1",
    marker_name: "LDL cholesterol",
    collected_on: "2026-11-09",
    value_numeric: 110,
    value_text: null,
    unit: "mg/dL",
    reference_low: 0,
    reference_high: 100,
    flag: "high",
    ...overrides,
  };
}

describe("HealthLabMarkerDisplay", () => {
  let mounted;
  afterEach(() => {
    if (mounted) unmount(mounted);
    mounted = null;
  });

  it("shows the value, an Above range chip and a bar with low/high ticks", () => {
    mounted = mount(point());
    expect(mounted.container.textContent).toContain("110 mg/dL");
    expect(mounted.container.textContent).toContain("Above range");
    expect(mounted.container.textContent).toContain("Low 0");
    expect(mounted.container.textContent).toContain("High 100");
    expect(mounted.container.textContent).not.toContain("Optimal");
    const bar = mounted.container.querySelector('[role="img"]');
    expect(bar.getAttribute("aria-label")).toContain("110 mg/dL");
    expect(bar.getAttribute("aria-label")).toContain("reference range 0 to 100 mg/dL");
    expect(bar.getAttribute("aria-label")).toContain("Above range");
    // Out-of-range marker pins to the edge with an arrow, not a dot.
    expect(bar.textContent).toContain("▶");
  });

  it("shows Within range for a value on the boundary", () => {
    mounted = mount(point({ value_numeric: 100, flag: "normal" }));
    expect(mounted.container.textContent).toContain("Within range");
  });

  it("shows Below range with a left arrow", () => {
    mounted = mount(point({ value_numeric: 5, reference_low: 40, reference_high: 60, flag: "low" }));
    expect(mounted.container.textContent).toContain("Below range");
    expect(mounted.container.querySelector('[role="img"]').textContent).toContain("◀");
  });

  it("shows value only with no chip, bar or bucket text when the range is missing", () => {
    mounted = mount(point({ reference_low: null, reference_high: null }));
    expect(mounted.container.textContent).toContain("110 mg/dL");
    expect(mounted.container.textContent).toContain("Reference range unavailable");
    expect(mounted.container.textContent).not.toContain("Above range");
    expect(mounted.container.querySelector('[role="img"]')).toBeNull();
  });

  it("shows value only for a one-sided range and for a non-numeric value", () => {
    mounted = mount(point({ reference_low: 0, reference_high: null }));
    expect(mounted.container.querySelector('[role="img"]')).toBeNull();
    unmount(mounted);
    mounted = mount(point({ value_numeric: null, value_text: "Positive", flag: "normal" }));
    expect(mounted.container.textContent).toContain("Positive");
    expect(mounted.container.querySelector('[role="img"]')).toBeNull();
  });

  it("shows the flag-conflict note without overriding the numeric status", () => {
    mounted = mount(point({ value_numeric: 50, flag: "high" }));
    expect(mounted.container.textContent).toContain("Within range");
    expect(mounted.container.textContent).toContain("Recorded flag: High; check source range");
  });

  it("shows the recorded critical flag as a separate qualifier", () => {
    mounted = mount(point({ value_numeric: 50, flag: "critical" }));
    expect(mounted.container.textContent).toContain("Within range");
    expect(mounted.container.textContent).toContain("Recorded flag: Critical");
  });
});
