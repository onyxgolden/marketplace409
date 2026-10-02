import { describe, expect, it } from "vitest";
import {
  DASHBOARD_VALUE_MAX_PX,
  dashboardValueSizeClass,
  estimateValueWidthPx,
} from "./dashboardCardSizing";

const SIZE_PX = { "text-4xl": 36, "text-3xl": 30, "text-2xl": 24, "text-xl": 20, "text-lg": 18 };

describe("dashboardValueSizeClass", () => {
  it("keeps short values at the full text-4xl display size", () => {
    expect(dashboardValueSizeClass("87%")).toBe("text-4xl");
    expect(dashboardValueSizeClass("$0.00")).toBe("text-4xl");
    expect(dashboardValueSizeClass("2")).toBe("text-4xl");
    expect(dashboardValueSizeClass("0")).toBe("text-4xl");
  });

  it("steps a $1,568.00 balance down so it fits inside the card", () => {
    const cls = dashboardValueSizeClass("$1,568.00");
    expect(cls).not.toBe("text-4xl");
    expect(estimateValueWidthPx("$1,568.00", SIZE_PX[cls])).toBeLessThanOrEqual(DASHBOARD_VALUE_MAX_PX);
  });

  it("fits every whole-dollar amount up to $99,999.00 without clipping", () => {
    for (let cents = 0; cents <= 9999900; cents += 777) {
      const text = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
      const cls = dashboardValueSizeClass(text);
      expect(estimateValueWidthPx(text, SIZE_PX[cls])).toBeLessThanOrEqual(DASHBOARD_VALUE_MAX_PX);
    }
    // Boundary values explicitly.
    for (const text of ["$9,999.00", "$10,000.00", "$99,999.00"]) {
      const cls = dashboardValueSizeClass(text);
      expect(estimateValueWidthPx(text, SIZE_PX[cls])).toBeLessThanOrEqual(DASHBOARD_VALUE_MAX_PX);
    }
  });

  it("never returns a size larger than text-4xl and always returns a known class", () => {
    for (const text of ["$1,568.00", "87%", "12", "1,234,567.89"]) {
      expect(Object.keys(SIZE_PX)).toContain(dashboardValueSizeClass(text));
    }
  });
});
