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
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      act(() => { toggle.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
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
});
