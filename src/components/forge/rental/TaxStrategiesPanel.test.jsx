// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import TaxStrategiesPanel from "./TaxStrategiesPanel";

// Pins the ported "8 Tax Strategies" page: the educational disclaimers at
// BOTH ends (top and bottom) are required content, all eight strategy cards
// survive the port, the filter behaves like the source page's own filter,
// and the tracker download slot is wired to the real file.

const STRATEGY_TITLES = [
  "Short-term rental loophole",
  "Real Estate Professional Status (REPS) + grouping election",
  "Cost segregation + 100% bonus depreciation",
  "1031 like-kind exchange (DST as the hands-off variant)",
  "§121 exclusion + §1031 stacking (the conversion play)",
  "Hiring your children",
  "The Augusta rule — §280A(g)",
  "Buy equipment for the business — §179 expensing &amp; bonus depreciation",
];

describe("TaxStrategiesPanel", () => {
  it("keeps the educational-only disclaimer at the top and the bottom of the page", () => {
    const markup = renderToStaticMarkup(<TaxStrategiesPanel />);
    expect(markup).toContain("Educational information only — this is not tax advice.");
    expect(markup).toContain("everything above is educational information only — not tax advice");
    expect(markup.indexOf("Educational information only")).toBeLessThan(
      markup.indexOf("Short-term rental loophole"),
    );
    expect(markup.indexOf("everything above is educational information only")).toBeGreaterThan(
      markup.indexOf("Buy equipment for the business"),
    );
    expect(markup).toContain("8 Tax Strategies to Reduce Your Income Taxes");
    expect(markup).toContain("Keep the mortgage for the write-off");
  });

  it("ports all eight strategy cards with their house-hack notes and complete rules", () => {
    const markup = renderToStaticMarkup(<TaxStrategiesPanel />);
    for (const title of STRATEGY_TITLES) expect(markup).toContain(title);
    expect(markup.match(/House-hack note/g)).toHaveLength(8);
    expect(markup.match(/Complete rules/g)).toHaveLength(8);
    // §179 stays a full card (Jason-approved 8-strategy structure).
    expect(markup).toContain("the $67,000 Bobcat");
    expect(markup).toContain("a deduction is a discount at your bracket rate, not a rebate");
    // The free tracker download slot is wired to the real spreadsheet.
    expect(markup).toContain('href="/downloads/hours-mileage-tracker.xlsx"');
    expect(markup).toContain("Download the free REPS &amp; material-participation hours tracker (Excel)");
  });

  describe("strategy filter (the source page's own interaction)", () => {
    let mounted;
    afterEach(() => {
      if (mounted) {
        act(() => mounted.root.unmount());
        mounted.container.remove();
        mounted = null;
      }
    });

    function mountPanel() {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      act(() => {
        root.render(<TaxStrategiesPanel />);
      });
      return { container, root };
    }

    function visibleCardTitles() {
      return Array.from(mounted.container.querySelectorAll("#cards article"))
        .filter((card) => !card.hidden)
        .map((card) => card.querySelector("h3").textContent);
    }

    it("shows all 8 by default, then filters to the exit strategies", () => {
      mounted = mountPanel();
      expect(visibleCardTitles()).toHaveLength(8);
      expect(mounted.container.textContent).toContain("Showing all 8 strategies, in ranked order. (8 of 8)");
      const exitButton = mounted.container.querySelector('button[data-filter="exit"]');
      act(() => {
        exitButton.click();
      });
      expect(exitButton.getAttribute("aria-pressed")).toBe("true");
      expect(visibleCardTitles()).toEqual([
        "1031 like-kind exchange (DST as the hands-off variant)",
        "§121 exclusion + §1031 stacking (the conversion play)",
      ]);
      expect(mounted.container.textContent).toContain("Strategies that protect you at sale or exit. (2 of 8)");
    });

    it("filters to the single filing-time strategy", () => {
      mounted = mountPanel();
      act(() => {
        mounted.container.querySelector('button[data-filter="filing"]').click();
      });
      expect(visibleCardTitles()).toEqual(["Cost segregation + 100% bonus depreciation"]);
      expect(mounted.container.textContent).toContain(
        "Strategies that can still be decided at filing time. (1 of 8)",
      );
    });
  });
});
