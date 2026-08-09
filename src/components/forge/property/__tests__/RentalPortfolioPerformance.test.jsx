import {
  describe,
  expect,
  it,
} from "vitest";

import {
  renderToStaticMarkup,
} from "react-dom/server";

import RentalPortfolioPerformance from "../RentalPortfolioPerformance.jsx";

function property({
  id = "property-1",
  name = "123 Main Street",
  negative = false,
} = {}) {
  return {
    propertyId: id,
    propertyName: name,
    transactionCount: 24,
    income: "$12,500.00",
    expenses: "$4,500.00",
    noi: negative
      ? "-$1,000.00"
      : "$9,000.00",
    noiIsNegative: negative,
    cashFlow: negative
      ? "-$500.00"
      : "$8,000.00",
    cashFlowIsNegative:
      negative,
  };
}

describe(
  "RentalPortfolioPerformance",
  () => {
    it(
      "renders loading and empty states without inferred data",
      () => {
        const loadingMarkup =
          renderToStaticMarkup(
            <RentalPortfolioPerformance
              loadState="loading"
              portfolio={null}
            />,
          );

        expect(
          loadingMarkup,
        ).toContain(
          "Loading rental portfolio activity...",
        );

        const emptyMarkup =
          renderToStaticMarkup(
            <RentalPortfolioPerformance
              loadState="ready"
              portfolio={null}
            />,
          );

        expect(
          emptyMarkup,
        ).toContain(
          "No rental portfolio data is available yet.",
        );
      },
    );

    it(
      "renders properties as a compact expandable list",
      () => {
        const markup =
          renderToStaticMarkup(
            <RentalPortfolioPerformance
              loadState="ready"
              portfolio={{
                metrics: [
                  {
                    label:
                      "Imported Income",
                    value:
                      "$25,000.00",
                  },
                ],
              }}
              properties={[
                property(),
                property({
                  id: "property-2",
                  name:
                    "456 Oak Avenue",
                }),
              ]}
              categories={[]}
              recentTransactions={[]}
            />,
          );

        expect(markup).toContain(
          "data-property-performance-list",
        );

        expect(markup).toContain(
          "Select a property to expand",
        );

        expect(markup).toContain(
          "123 Main Street",
        );

        expect(markup).toContain(
          "456 Oak Avenue",
        );

        expect(markup).not.toContain(
          "data-featured-properties",
        );

        expect(markup).not.toContain(
          "data-additional-properties",
        );

        expect(markup).not.toContain(
          "View all",
        );
      },
    );

    it(
      "preserves portfolio, category, and transaction presentation",
      () => {
        const markup =
          renderToStaticMarkup(
            <RentalPortfolioPerformance
              loadState="ready"
              portfolio={{
                metrics: [
                  {
                    label:
                      "Imported Income",
                    value:
                      "$25,000.00",
                  },
                ],
              }}
              properties={[
                property(),
              ]}
              categories={[
                {
                  category:
                    "repairs",
                  label: "Repairs",
                  value:
                    "-$1,500.00",
                  isNegative: true,
                },
              ]}
              recentTransactions={[
                {
                  id: "event-1",
                  description:
                    "August Rent",
                  eventDate:
                    "2026-08-01",
                  propertyName:
                    "123 Main Street",
                  amount:
                    "$1,500.00",
                  isIncome: true,
                  categoryLabel:
                    "Rental Income",
                  sourceSystem:
                    "rentec",
                },
              ]}
            />,
          );

        expect(markup).toContain(
          "$25,000.00",
        );

        expect(markup).toContain(
          "Repairs",
        );

        expect(markup).toContain(
          "-$1,500.00",
        );

        expect(markup).toContain(
          "August Rent",
        );

        expect(markup).toContain(
          "+$1,500.00",
        );
      },
    );

    it(
      "renders year and month reporting-period options",
      () => {
        const markup =
          renderToStaticMarkup(
            <RentalPortfolioPerformance
              loadState="ready"
              portfolio={{
                metrics: [],
              }}
              periodOptions={[
                {
                  key:
                    "year:2026",
                  label:
                    "2026 — Full year",
                },
                {
                  key:
                    "month:2026-08",
                  label:
                    "August 2026",
                },
                {
                  key: "all",
                  label:
                    "All time",
                },
              ]}
              selectedPeriodKey={
                "year:2026"
              }
              selectedPeriodLabel={
                "2026 — Full year"
              }
            />,
          );

        expect(markup).toContain(
          "data-financial-period-select",
        );

        expect(markup).toContain(
          "2026 — Full year",
        );

        expect(markup).toContain(
          "August 2026",
        );

        expect(markup).toContain(
          "All time",
        );
      },
    );

    it(
      "renders populated-section empty collections",
      () => {
        const markup =
          renderToStaticMarkup(
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
      },
    );
  },
);
