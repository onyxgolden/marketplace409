import {
  describe,
  expect,
  it,
} from "vitest";

import {
  renderToStaticMarkup,
} from "react-dom/server";

import RentalPropertyPerformanceCard from "../RentalPropertyPerformanceCard.jsx";

describe("RentalPropertyPerformanceCard", () => {
  it("renders repository-backed property performance", () => {
    const markup = renderToStaticMarkup(
      <RentalPropertyPerformanceCard
        propertyName="123 Main Street"
        transactionCount={24}
        income="$12,500.00"
        expenses="$4,500.00"
        noi="$9,000.00"
        cashFlow="$8,000.00"
      />,
    );

    expect(markup).toContain("Rental Property");
    expect(markup).toContain("123 Main Street");
    expect(markup).toContain("24 transactions");
    expect(markup).toContain("Income");
    expect(markup).toContain("$12,500.00");
    expect(markup).toContain("Expenses");
    expect(markup).toContain("$4,500.00");
    expect(markup).toContain("NOI");
    expect(markup).toContain("$9,000.00");
    expect(markup).toContain("Cash Flow");
    expect(markup).toContain("$8,000.00");
  });

  it("retains the four established performance treatments", () => {
    const markup = renderToStaticMarkup(
      <RentalPropertyPerformanceCard
        propertyName="Rental"
        transactionCount={0}
        income="$0.00"
        expenses="$0.00"
        noi="$0.00"
        cashFlow="$0.00"
      />,
    );

    expect(markup).toContain("bg-emerald-50");
    expect(markup).toContain("bg-rose-50");
    expect(markup).toContain("bg-amber-50");
    expect(markup).toContain("bg-sky-50");
  });
});
