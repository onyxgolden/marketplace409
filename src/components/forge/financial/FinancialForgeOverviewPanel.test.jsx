// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import FinancialForgeOverviewPanel from "./FinancialForgeOverviewPanel";

function daysFromNow(days) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

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

const transactions = [
  { id: "b1", eventDate: daysFromNow(-2), amount: 1500, transactionKind: "income", category: "rental_income", businessScope: "business", financialAccountId: "acct-biz" },
  { id: "b2", eventDate: daysFromNow(-3), amount: 200, transactionKind: "expense", category: "utilities", businessScope: "business", financialAccountId: "acct-biz" },
  { id: "p1", eventDate: daysFromNow(-1), amount: 75, transactionKind: "expense", category: "dining", businessScope: "personal", financialAccountId: "acct-personal" },
];

const categoryClickTransactions = [
  { id: "inc-old", eventDate: daysFromNow(-20), description: "January rent", amount: 1200, transactionKind: "income", category: "rental_income", businessScope: "business", sourceSystem: "manual" },
  { id: "inc-new", eventDate: daysFromNow(-5), description: "Second January rent", amount: 1300, transactionKind: "income", category: "rental_income", businessScope: "business", sourceSystem: "forge_rental_payment" },
  { id: "inc-other-cat", eventDate: daysFromNow(-10), description: "Interest", amount: 5, transactionKind: "income", category: "interest_income", businessScope: "business", sourceSystem: "manual" },
  { id: "exp-1", eventDate: daysFromNow(-8), description: "Electric bill", amount: 90, transactionKind: "expense", category: "utilities", businessScope: "business", sourceSystem: "manual" },
];
const accounts = [
  { id: "acct-biz", name: "Business Savings" },
  { id: "acct-personal", name: "Chase Credit Card" },
];

describe("FinancialForgeOverviewPanel", () => {
  it("shows a loading state before data arrives", () => {
    const markup = renderToStaticMarkup(<FinancialForgeOverviewPanel loadState="loading" transactions={[]} accounts={[]} />);
    expect(markup).toContain("Loading Financial FORGE activity");
  });

  it("defaults to the business scope and never shows personal category/account activity there", () => {
    const markup = renderToStaticMarkup(<FinancialForgeOverviewPanel loadState="ready" transactions={transactions} accounts={accounts} />);
    expect(markup).toContain("Utilities");
    expect(markup).not.toContain("Dining");
    expect(markup).toContain("Business Savings");
    expect(markup).not.toContain("Chase Credit Card");
  });

  it("switches to the personal scope and shows only personal activity, on click", () => {
    let mounted;
    try {
      mounted = mount(<FinancialForgeOverviewPanel loadState="ready" transactions={transactions} accounts={accounts} />);
      const personalButton = mounted.container.querySelector('[data-scope-option="personal"]');
      act(() => { personalButton.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

      expect(mounted.container.textContent).toContain("Chase Credit Card");
      expect(mounted.container.textContent).not.toContain("Business Savings");
      expect(mounted.container.querySelector('[data-scope-option="personal"]').getAttribute("aria-pressed")).toBe("true");
    } finally {
      if (mounted) unmount(mounted);
    }
  });

  it("renders a data-coverage notice naming the imported date range for the active scope", () => {
    const markup = renderToStaticMarkup(<FinancialForgeOverviewPanel loadState="ready" transactions={transactions} accounts={accounts} />);
    expect(markup).toMatch(/Imported business transaction history covers/);
  });

  it("shows income and expenses as category donuts, each slice a real category from the data", () => {
    const markup = renderToStaticMarkup(<FinancialForgeOverviewPanel loadState="ready" transactions={transactions} accounts={accounts} />);
    expect(markup).toContain("Income by category");
    expect(markup).toContain("Expenses by category");
    expect(markup).toContain("Rental Income");
    expect(markup).toContain("$1,500.00");
    expect(markup).toContain("100%");
    expect(markup).toContain("Utilities");
    expect(markup).toContain("$200.00");
  });

  it("gives the category donuts their own This Month / 6 Months / All Time period control, independent of the main period selector", () => {
    let mounted;
    try {
      mounted = mount(<FinancialForgeOverviewPanel loadState="ready" transactions={transactions} accounts={accounts} />);
      for (const label of ["This Month", "6 Months", "All Time"]) {
        expect(mounted.container.textContent).toContain(label);
      }
      const sixMonthsButton = mounted.container.querySelector('[data-donut-period-option="sixMonths"]');
      expect(sixMonthsButton.getAttribute("aria-pressed")).toBe("true");

      const monthButton = mounted.container.querySelector('[data-donut-period-option="month"]');
      act(() => { monthButton.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      expect(monthButton.getAttribute("aria-pressed")).toBe("true");
      expect(sixMonthsButton.getAttribute("aria-pressed")).toBe("false");
      // The main bar-chart/table period selector is untouched by the donut-only control.
      expect(mounted.container.querySelector('[data-period-option="sixMonths"]').getAttribute("aria-pressed")).toBe("true");
    } finally {
      if (mounted) unmount(mounted);
    }
  });

  it("shows all four period preset controls plus a business/personal toggle", () => {
    const markup = renderToStaticMarkup(<FinancialForgeOverviewPanel loadState="ready" transactions={transactions} accounts={accounts} />);
    for (const label of ["6 Months", "YTD", "Year", "All time", "Business", "Personal"]) {
      expect(markup).toContain(label);
    }
  });

  it("groups expense categories into collapsible parent buckets with a subtotal, and collapses on click", () => {
    let mounted;
    try {
      mounted = mount(<FinancialForgeOverviewPanel loadState="ready" transactions={transactions} accounts={accounts} />);
      // Business scope here has "utilities" ($200 expense) -> grouped under "Utilities".
      const group = mounted.container.querySelector('[data-category-group="utilities"]');
      expect(group).not.toBeNull();
      expect(group.textContent).toContain("Utilities");
      expect(group.textContent).toContain("-$200.00");
      expect(mounted.container.textContent).toContain("Utilities");

      const toggle = group.querySelector("button");
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      act(() => { toggle.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
    } finally {
      if (mounted) unmount(mounted);
    }
  });

  it("reveals a year selector only once the Year preset is active", () => {
    let mounted;
    try {
      mounted = mount(<FinancialForgeOverviewPanel loadState="ready" transactions={transactions} accounts={accounts} />);
      expect(mounted.container.querySelector("select")).toBeNull();

      const yearButton = mounted.container.querySelector('[data-period-option="year"]');
      act(() => { yearButton.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

      expect(mounted.container.querySelector("select")).not.toBeNull();
    } finally {
      if (mounted) unmount(mounted);
    }
  });

  describe("clicking a category slice shows its activity over the opposing card", () => {
    function clickLegendRow(container, key) {
      const button = container.querySelector(`[data-donut-legend-row="${key}"] button`);
      act(() => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    }

    it("clicking an income category shows its filtered, sorted activity where the Expenses card was, with manual entries labeled", () => {
      let mounted;
      try {
        mounted = mount(<FinancialForgeOverviewPanel loadState="ready" transactions={categoryClickTransactions} accounts={[]} />);
        act(() => { mounted.container.querySelector('[data-donut-period-option="allTime"]').dispatchEvent(new MouseEvent("click", { bubbles: true })); });

        clickLegendRow(mounted.container, "rental_income");

        const list = mounted.container.querySelector("[data-category-activity-list]");
        expect(list).not.toBeNull();
        expect(list.textContent).toContain("Rental Income");
        expect(list.textContent).toContain("Income activity");

        // Expenses card is where the list rendered; Expenses by category chart is gone.
        expect(mounted.container.textContent).not.toContain("Expenses by category");
        // Income by category chart is still showing (list replaced the OTHER card).
        expect(mounted.container.textContent).toContain("Income by category");

        // Newest first: inc-new ($1,300) before inc-old ($1,200); inc-other-cat excluded (different category).
        const rows = Array.from(list.children[1].children);
        expect(rows[0].textContent).toContain("Second January rent");
        expect(rows[1].textContent).toContain("January rent");
        expect(list.textContent).not.toContain("Interest");

        // Manual entry labeled; the forge_rental_payment one is not.
        expect(rows[1].textContent).toContain("Manual entry");
        expect(rows[0].textContent).not.toContain("Manual entry");
      } finally {
        if (mounted) unmount(mounted);
      }
    });

    it("clicking an expense category shows its activity where the Income card was", () => {
      let mounted;
      try {
        mounted = mount(<FinancialForgeOverviewPanel loadState="ready" transactions={categoryClickTransactions} accounts={[]} />);
        act(() => { mounted.container.querySelector('[data-donut-period-option="allTime"]').dispatchEvent(new MouseEvent("click", { bubbles: true })); });

        clickLegendRow(mounted.container, "utilities");

        const list = mounted.container.querySelector("[data-category-activity-list]");
        expect(list).not.toBeNull();
        expect(list.textContent).toContain("Utilities");
        expect(list.textContent).toContain("Expense activity");
        expect(list.textContent).toContain("Electric bill");
        expect(mounted.container.textContent).not.toContain("Income by category");
        expect(mounted.container.textContent).toContain("Expenses by category");
      } finally {
        if (mounted) unmount(mounted);
      }
    });

    it("the explicit Back control closes the list and restores both donut charts", () => {
      let mounted;
      try {
        mounted = mount(<FinancialForgeOverviewPanel loadState="ready" transactions={categoryClickTransactions} accounts={[]} />);
        act(() => { mounted.container.querySelector('[data-donut-period-option="allTime"]').dispatchEvent(new MouseEvent("click", { bubbles: true })); });
        clickLegendRow(mounted.container, "rental_income");
        expect(mounted.container.querySelector("[data-category-activity-list]")).not.toBeNull();

        const backButton = Array.from(mounted.container.querySelectorAll("[data-category-activity-list] button")).find((b) => b.textContent.includes("Back"));
        act(() => { backButton.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

        expect(mounted.container.querySelector("[data-category-activity-list]")).toBeNull();
        expect(mounted.container.textContent).toContain("Income by category");
        expect(mounted.container.textContent).toContain("Expenses by category");
      } finally {
        if (mounted) unmount(mounted);
      }
    });

    it("clicking outside the donut cards dismisses the list", () => {
      let mounted;
      try {
        mounted = mount(<FinancialForgeOverviewPanel loadState="ready" transactions={categoryClickTransactions} accounts={[]} />);
        act(() => { mounted.container.querySelector('[data-donut-period-option="allTime"]').dispatchEvent(new MouseEvent("click", { bubbles: true })); });
        clickLegendRow(mounted.container, "rental_income");
        expect(mounted.container.querySelector("[data-category-activity-list]")).not.toBeNull();

        act(() => { document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });

        expect(mounted.container.querySelector("[data-category-activity-list]")).toBeNull();
      } finally {
        if (mounted) unmount(mounted);
      }
    });

    it("clicking the same category again toggles the list closed", () => {
      let mounted;
      try {
        mounted = mount(<FinancialForgeOverviewPanel loadState="ready" transactions={categoryClickTransactions} accounts={[]} />);
        act(() => { mounted.container.querySelector('[data-donut-period-option="allTime"]').dispatchEvent(new MouseEvent("click", { bubbles: true })); });
        clickLegendRow(mounted.container, "rental_income");
        expect(mounted.container.querySelector("[data-category-activity-list]")).not.toBeNull();

        clickLegendRow(mounted.container, "rental_income");

        expect(mounted.container.querySelector("[data-category-activity-list]")).toBeNull();
      } finally {
        if (mounted) unmount(mounted);
      }
    });

    it("clicking a different category while one is open swaps to the new selection instead of stacking", () => {
      let mounted;
      try {
        mounted = mount(<FinancialForgeOverviewPanel loadState="ready" transactions={categoryClickTransactions} accounts={[]} />);
        act(() => { mounted.container.querySelector('[data-donut-period-option="allTime"]').dispatchEvent(new MouseEvent("click", { bubbles: true })); });
        clickLegendRow(mounted.container, "rental_income");
        expect(mounted.container.querySelectorAll("[data-category-activity-list]").length).toBe(1);
        expect(mounted.container.querySelector("[data-category-activity-list]").textContent).toContain("Rental Income");

        clickLegendRow(mounted.container, "interest_income");

        expect(mounted.container.querySelectorAll("[data-category-activity-list]").length).toBe(1);
        expect(mounted.container.querySelector("[data-category-activity-list]").textContent).toContain("Interest Income");
      } finally {
        if (mounted) unmount(mounted);
      }
    });
  });
});
