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

    expect(markup).toContain(
      "data-property-performance-card",
    );

    expect(markup).toContain("Rental Property");
    expect(markup).toContain("123 Main Street");
    expect(markup).toContain("24 transactions");
    expect(markup).toContain(
      "Operating Performance",
    );

    expect(markup).toContain(
      "Repository-backed imported activity",
    );

    expect(markup).toContain(
      "Net Operating Income",
    );

    expect(markup).toContain("$9,000.00");
    expect(markup).toContain("Cash Flow");
    expect(markup).toContain("$8,000.00");
    expect(markup).toContain("Income");
    expect(markup).toContain("$12,500.00");
    expect(markup).toContain("Expenses");
    expect(markup).toContain("$4,500.00");
  });

  it("promotes operating outcomes above supporting activity", () => {
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

    expect(markup).toContain("from-amber-50");
    expect(markup).toContain("from-sky-50");
    expect(markup).toContain("bg-emerald-500");
    expect(markup).toContain("bg-rose-500");
    expect(markup).toContain("Imported");
  });

  it("marks negative operating outcomes as risks", () => {
    const markup = renderToStaticMarkup(
      <RentalPropertyPerformanceCard
        propertyName="185 Laxon"
        transactionCount={89}
        income="$123,808.93"
        expenses="$21,693.10"
        noi="-$593.10"
        cashFlow="$102,115.83"
        noiIsNegative
      />,
    );

    expect(markup).toContain(
      'data-performance-status="negative"',
    );

    expect(markup).toContain(
      'data-performance-status="positive"',
    );

    expect(markup).toContain("from-rose-50");
    expect(markup).toContain("text-rose-950");
    expect(markup).toContain("-$593.10");
  });

  it("marks negative cash flow as a risk", () => {
    const markup = renderToStaticMarkup(
      <RentalPropertyPerformanceCard
        propertyName="Cash Flow Risk"
        transactionCount={12}
        income="$10,000.00"
        expenses="$12,000.00"
        noi="$1,000.00"
        cashFlow="-$2,000.00"
        cashFlowIsNegative
      />,
    );

    expect(markup).toContain(
      'data-performance-status="negative"',
    );

    expect(markup).toContain("from-rose-50");
    expect(markup).toContain("-$2,000.00");
  });

  it("uses singular transaction wording", () => {
    const markup = renderToStaticMarkup(
      <RentalPropertyPerformanceCard
        propertyName="Rental"
        transactionCount={1}
        income="$0.00"
        expenses="$0.00"
        noi="$0.00"
        cashFlow="$0.00"
      />,
    );

    expect(markup).toContain("1 transaction");
    expect(markup).not.toContain("1 transactions");
  });
});
