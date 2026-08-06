import {
  describe,
  expect,
  it,
} from "vitest";

import {
  renderToStaticMarkup,
} from "react-dom/server";

import RentalPortfolioPerformance from "../RentalPortfolioPerformance.jsx";

describe("RentalPortfolioPerformance", () => {
  it("renders the loading state without inferred portfolio data", () => {
    const markup = renderToStaticMarkup(
      <RentalPortfolioPerformance
        loadState="loading"
        portfolio={null}
      />,
    );

    expect(markup).toContain(
      "data-rental-portfolio-performance",
    );

    expect(markup).toContain(
      "Loading rental portfolio activity...",
    );

    expect(markup).toContain("Repository Backed");
  });

  it("renders the ready empty state", () => {
    const markup = renderToStaticMarkup(
      <RentalPortfolioPerformance
        loadState="ready"
        portfolio={null}
      />,
    );

    expect(markup).toContain(
      "No rental portfolio data is available yet.",
    );

    expect(markup).toContain(
      "Import a Rentec financial file",
    );
  });

  it("composes repository-backed portfolio presentation", () => {
    const markup = renderToStaticMarkup(
      <RentalPortfolioPerformance
        loadState="ready"
        portfolio={{
          metrics: [
            {
              label: "Imported Income",
              value: "$25,000.00",
            },
            {
              label: "NOI",
              value: "$12,000.00",
            },
            {
              label: "Transactions",
              value: "42",
            },
          ],
        }}
        properties={[
          {
            propertyId: "property-1",
            propertyName: "123 Main Street",
            transactionCount: 24,
            income: "$12,500.00",
            expenses: "$4,500.00",
            noi: "$9,000.00",
            noiIsNegative: false,
            cashFlow: "$8,000.00",
            cashFlowIsNegative: false,
          },
        ]}
        categories={[
          {
            category: "repairs",
            label: "Repairs",
            value: "-$1,500.00",
            isNegative: true,
          },
        ]}
        recentTransactions={[
          {
            id: "event-1",
            description: "August Rent",
            eventDate: "2026-08-01",
            propertyName: "123 Main Street",
            amount: "$1,500.00",
            isIncome: true,
            categoryLabel: "Rental Income",
            sourceSystem: "rentec",
          },
        ]}
      />,
    );

    expect(markup).toContain(
      "Rental Portfolio Summary",
    );

    expect(markup).toContain("$25,000.00");
    expect(markup).toContain("1 property");
    expect(markup).toContain("123 Main Street");
    expect(markup).toContain("24 transactions");
    expect(markup).toContain("Repairs");
    expect(markup).toContain("-$1,500.00");
    expect(markup).toContain("August Rent");
    expect(markup).toContain("+$1,500.00");
  });

  it("renders populated-section empty collections", () => {
    const markup = renderToStaticMarkup(
      <RentalPortfolioPerformance
        loadState="ready"
        portfolio={{
          metrics: [],
        }}
      />,
    );

    expect(markup).toContain(
      "No property-linked financial events were found.",
    );

    expect(markup).toContain(
      "No categorized activity yet.",
    );

    expect(markup).toContain(
      "No imported financial activity yet.",
    );
  });
});
