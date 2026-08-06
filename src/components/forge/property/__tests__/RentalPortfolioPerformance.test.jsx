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

  it("features negative properties while collapsing additional cards", () => {
    const properties = Array.from(
      { length: 7 },
      (_, index) => ({
        propertyId: `property-${index + 1}`,
        propertyName:
          index === 6
            ? "Negative Property"
            : `Property ${index + 1}`,
        transactionCount: index + 1,
        income: "$10,000.00",
        expenses: "$5,000.00",
        noi:
          index === 6
            ? "-$1,000.00"
            : "$5,000.00",
        noiIsNegative: index === 6,
        cashFlow:
          index === 6
            ? "-$2,000.00"
            : "$4,000.00",
        cashFlowIsNegative:
          index === 6,
      }),
    );

    const markup = renderToStaticMarkup(
      <RentalPortfolioPerformance
        loadState="ready"
        portfolio={{
          metrics: [],
        }}
        properties={properties}
        initialPropertyCount={3}
      />,
    );

    expect(markup).toContain(
      "data-featured-properties",
    );
    expect(markup).toContain(
      "data-additional-properties",
    );
    expect(markup).toContain(
      "View all 7 properties",
    );
    expect(markup).toContain(
      "4 additional",
    );

    const featuredMarkup =
      markup
        .split(
          "data-featured-properties",
        )[1]
        .split(
          "data-additional-properties",
        )[0];

    const additionalMarkup =
      markup.split(
        "data-additional-properties",
      )[1];

    expect(featuredMarkup).toContain(
      "Negative Property",
    );
    expect(featuredMarkup).toContain(
      "Property 1",
    );
    expect(featuredMarkup).toContain(
      "Property 2",
    );
    expect(featuredMarkup).not.toContain(
      "Property 3",
    );

    expect(additionalMarkup).toContain(
      "Property 3",
    );
    expect(additionalMarkup).toContain(
      "Property 6",
    );
    expect(additionalMarkup).not.toContain(
      "Negative Property",
    );
  });

  it("omits disclosure when every property is featured", () => {
    const markup = renderToStaticMarkup(
      <RentalPortfolioPerformance
        loadState="ready"
        portfolio={{
          metrics: [],
        }}
        properties={[
          {
            propertyId: "property-1",
            propertyName: "Only Property",
            transactionCount: 1,
            income: "$1,000.00",
            expenses: "$500.00",
            noi: "$500.00",
            noiIsNegative: false,
            cashFlow: "$500.00",
            cashFlowIsNegative: false,
          },
        ]}
      />,
    );

    expect(markup).toContain(
      "Only Property",
    );
    expect(markup).not.toContain(
      "data-additional-properties",
    );
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
