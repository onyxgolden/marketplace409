import {
  describe,
  expect,
  it,
} from "vitest";

import {
  renderToStaticMarkup,
} from "react-dom/server";

import FinancialTransactionsSurface from "../FinancialTransactionsSurface.jsx";

describe(
  "FinancialTransactionsSurface",
  () => {
    it(
      "renders a focused responsive transaction table",
      () => {
        const markup =
          renderToStaticMarkup(
            <FinancialTransactionsSurface
              transactions={[
                {
                  id: "transaction-1",
                  eventDate:
                    "2026-08-01",
                  description:
                    "August rent",
                  propertyName:
                    "4800 Kent Ave",
                  categoryLabel:
                    "Rental Income",
                  sourceSystem:
                    "Plaid",
                  amount:
                    "$1,250.00",
                  isIncome: true,
                },
                {
                  id: "transaction-2",
                  eventDate:
                    "2026-08-02",
                  description:
                    "HVAC service",
                  propertyName:
                    "4800 Kent Ave",
                  categoryLabel:
                    "Repairs",
                  sourceSystem:
                    "Manual",
                  amount:
                    "$950.00",
                  isIncome: false,
                },
              ]}
            />,
          );

        expect(markup).toContain(
          "data-financial-transactions-surface",
        );

        expect(markup).toContain(
          "Recent transactions",
        );

        expect(markup).toContain(
          "August rent",
        );

        expect(markup).toContain(
          "HVAC service",
        );

        expect(markup).toContain(
          "+$1,250.00",
        );

        expect(markup).toContain(
          "-$950.00",
        );

        expect(markup).toContain(
          "overflow-x-auto",
        );

        expect(markup).toContain(
          "min-w-[900px]",
        );
      },
    );

    it(
      "renders loading and empty states",
      () => {
        expect(
          renderToStaticMarkup(
            <FinancialTransactionsSurface
              loadState="loading"
            />,
          ),
        ).toContain(
          "Loading transactions...",
        );

        expect(
          renderToStaticMarkup(
            <FinancialTransactionsSurface />,
          ),
        ).toContain(
          "No transactions are available.",
        );
      },
    );
  },
);
