import {
  describe,
  expect,
  it,
} from "vitest";

import {
  renderToStaticMarkup,
} from "react-dom/server";

import RentalPropertyPerformanceCard from "../RentalPropertyPerformanceCard.jsx";

function renderProperty(
  overrides = {},
) {
  return renderToStaticMarkup(
    <RentalPropertyPerformanceCard
      propertyName="123 Main Street"
      transactionCount={24}
      income="$12,500.00"
      expenses="$4,500.00"
      noi="$9,000.00"
      cashFlow="$8,000.00"
      {...overrides}
    />,
  );
}

describe(
  "RentalPropertyPerformanceCard",
  () => {
    it(
      "starts as a compact clickable disclosure row",
      () => {
        const markup =
          renderProperty();

        expect(markup).toContain(
          "data-property-performance-item",
        );

        expect(markup).toContain(
          "<summary",
        );

        expect(markup).not.toContain(
          "<details open",
        );

        expect(markup).toContain(
          "123 Main Street",
        );

        expect(markup).toContain(
          "24 transactions",
        );

        expect(markup).toContain(
          "$9,000.00",
        );

        expect(markup).toContain(
          "$8,000.00",
        );
      },
    );

    it(
      "places supporting activity inside expandable details",
      () => {
        const markup =
          renderProperty();

        expect(markup).toContain(
          "data-property-performance-details",
        );

        expect(markup).toContain(
          "Income",
        );

        expect(markup).toContain(
          "$12,500.00",
        );

        expect(markup).toContain(
          "Expenses",
        );

        expect(markup).toContain(
          "$4,500.00",
        );
      },
    );

    it(
      "marks negative operating outcomes for review",
      () => {
        const markup =
          renderProperty({
            noi:
              "-$1,000.00",
            noiIsNegative:
              true,
          });

        expect(markup).toContain(
          'data-performance-status="negative"',
        );

        expect(markup).toContain(
          "Review",
        );

        expect(markup).toContain(
          "text-rose-700",
        );
      },
    );

    it(
      "marks healthy rows as current",
      () => {
        const markup =
          renderProperty();

        expect(markup).toContain(
          'data-performance-status="positive"',
        );

        expect(markup).toContain(
          "Current",
        );
      },
    );

    it(
      "uses singular transaction wording",
      () => {
        const markup =
          renderProperty({
            transactionCount: 1,
          });

        expect(markup).toContain(
          "1 transaction",
        );

        expect(markup).not.toContain(
          "1 transactions",
        );
      },
    );
  },
);
