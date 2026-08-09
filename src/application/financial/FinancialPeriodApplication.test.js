import {
  describe,
  expect,
  it,
} from "vitest";

import {
  buildFinancialPeriodModel,
  buildFinancialPeriodOptions,
  resolveFinancialPeriodKey,
} from "./FinancialPeriodApplication.js";

function transaction({
  id,
  eventDate,
  amount,
  transactionKind,
  propertyId =
    "1214-wagner",
  category =
    "rental_income",
  affectsNOI = true,
}) {
  return {
    id,
    eventDate,
    amount,
    transactionKind,
    propertyId,
    category,
    affectsNOI,
    capitalized: false,
    description: id,
    sourceSystem: "rentec",
  };
}

function obligation({
  id = "tax-2025",
  propertyId =
    "1214-wagner",
  scope = "property",
  recognitionStatus =
    "accrual_ready",
  status = "active",
  annualAmountCents =
    120000,
  servicePeriodStart =
    "2025-01-01",
  servicePeriodEnd =
    "2026-01-01",
  reconciledFinancialEventId =
    null,
} = {}) {
  return {
    id,
    propertyId,
    scope,
    recognitionStatus,
    status,
    annualAmountCents,
    servicePeriodStart,
    servicePeriodEnd,
    reconciledFinancialEventId,
    obligationType:
      "property_tax",
    subjectLabel:
      "2025 property tax",
    currencyCode:
      "USD",
    businessUseBasisPoints:
      null,
  };
}

const transactions = [
  transaction({
    id: "january-rent",
    eventDate:
      "2025-01-05",
    amount: 1500,
    transactionKind:
      "income",
  }),
  transaction({
    id: "january-repair",
    eventDate:
      "2025-01-10",
    amount: 250,
    transactionKind:
      "expense",
    category: "repairs",
  }),
  transaction({
    id: "february-rent",
    eventDate:
      "2025-02-05",
    amount: 1600,
    transactionKind:
      "income",
  }),
  transaction({
    id: "new-year-rent",
    eventDate:
      "2026-01-05",
    amount: 1700,
    transactionKind:
      "income",
  }),
];

describe(
  "FinancialPeriodApplication",
  () => {
    it(
      "builds available years and active months",
      () => {
        const options =
          buildFinancialPeriodOptions(
            transactions,
          );

        expect(
          options.map(
            ({ key }) => key,
          ),
        ).toEqual([
          "year:2026",
          "month:2026-01",
          "year:2025",
          "month:2025-02",
          "month:2025-01",
          "all",
        ]);
      },
    );

    it(
      "defaults to the latest year containing activity",
      () => {
        expect(
          resolveFinancialPeriodKey({
            transactions,
          }),
        ).toBe(
          "year:2026",
        );
      },
    );

    it(
      "aggregates one selected month using canonical rules",
      () => {
        const model =
          buildFinancialPeriodModel({
            transactions,
            requestedPeriodKey:
              "month:2025-01",
          });

        expect(
          model.selectedPeriodLabel,
        ).toBe(
          "January 2025",
        );

        expect(
          model.workspace.portfolio,
        ).toEqual({
          income: 1500,
          expenses: 250,
          accruedOperatingExpenses: 0,
          noi: 1250,
          cashFlow: 1250,
          transactionCount: 2,
        });

        expect(
          model.workspace.properties,
        ).toHaveLength(1);

        expect(
          model.workspace.categories,
        ).toHaveLength(2);
      },
    );

    it(
      "aggregates a selected full year",
      () => {
        const model =
          buildFinancialPeriodModel({
            transactions,
            requestedPeriodKey:
              "year:2025",
          });

        expect(
          model.workspace
            .portfolio,
        ).toEqual({
          income: 3100,
          expenses: 250,
          accruedOperatingExpenses: 0,
          noi: 2850,
          cashFlow: 2850,
          transactionCount: 3,
        });
      },
    );

    it(
      "retains explicit all-time aggregation",
      () => {
        const model =
          buildFinancialPeriodModel({
            transactions,
            requestedPeriodKey:
              "all",
          });

        expect(
          model.workspace
            .portfolio
            .transactionCount,
        ).toBe(4);

        expect(
          model.workspace
            .portfolio
            .income,
        ).toBe(4800);
      },
    );

    it(
      "ignores invalid dates for dated periods",
      () => {
        const model =
          buildFinancialPeriodModel({
            transactions: [
              ...transactions,
              transaction({
                id:
                  "undated",
                eventDate:
                  "invalid",
                amount: 900,
                transactionKind:
                  "income",
              }),
            ],
          });

        expect(
          model.selectedPeriodKey,
        ).toBe(
          "year:2026",
        );

        expect(
          model.workspace
            .portfolio
            .transactionCount,
        ).toBe(1);
      },
    );
    it(
      "accrues annual property costs into yearly NOI without changing cash flow",
      () => {
        const model =
          buildFinancialPeriodModel({
            transactions,
            obligations: [
              obligation(),
            ],
            requestedPeriodKey:
              "year:2025",
          });

        expect(
          model.workspace
            .portfolio
            .accruedOperatingExpenses,
        ).toBe(1200);

        expect(
          model.workspace
            .portfolio.noi,
        ).toBe(1650);

        expect(
          model.workspace
            .portfolio.cashFlow,
        ).toBe(2850);

        expect(
          model.workspace
            .properties[0]
            .accruedOperatingExpenses,
        ).toBe(1200);
      },
    );

    it(
      "allocates annual property costs by exact calendar days for a month",
      () => {
        const model =
          buildFinancialPeriodModel({
            transactions,
            obligations: [
              obligation(),
            ],
            requestedPeriodKey:
              "month:2025-01",
          });

        expect(
          model.workspace
            .portfolio
            .accruedOperatingExpenses,
        ).toBe(101.91);

        expect(
          model.workspace
            .portfolio.noi,
        ).toBe(1148.09);

        expect(
          model.workspace
            .portfolio.cashFlow,
        ).toBe(1250);
      },
    );

    it(
      "keeps reconciled payments in cash expenses while suppressing duplicate NOI",
      () => {
        const taxPayment =
          transaction({
            id:
              "tax-payment",
            eventDate:
              "2026-02-01",
            amount: 1200,
            transactionKind:
              "expense",
            category:
              "property_tax",
          });

        const model =
          buildFinancialPeriodModel({
            transactions: [
              ...transactions,
              taxPayment,
            ],
            obligations: [
              obligation({
                reconciledFinancialEventId:
                  "tax-payment",
              }),
            ],
            requestedPeriodKey:
              "year:2026",
          });

        expect(
          model.workspace
            .portfolio.expenses,
        ).toBe(1200);

        expect(
          model.workspace
            .portfolio.noi,
        ).toBe(1700);

        expect(
          model.workspace
            .portfolio.cashFlow,
        ).toBe(500);

        expect(
          model.workspace
            .portfolio
            .accruedOperatingExpenses,
        ).toBe(0);
      },
    );

    it(
      "ignores provisional insurance without verified coverage dates",
      () => {
        const model =
          buildFinancialPeriodModel({
            transactions,
            obligations: [
              obligation({
                id:
                  "pending-insurance",
                recognitionStatus:
                  "dates_needed",
                status:
                  "provisional",
                servicePeriodStart:
                  null,
                servicePeriodEnd:
                  null,
              }),
            ],
            requestedPeriodKey:
              "year:2025",
          });

        expect(
          model.workspace
            .portfolio
            .accruedOperatingExpenses,
        ).toBe(0);

        expect(
          model.workspace
            .portfolio.noi,
        ).toBe(2850);
      },
    );

    it(
      "uses full obligation service periods for all-time NOI",
      () => {
        const model =
          buildFinancialPeriodModel({
            transactions,
            obligations: [
              obligation(),
            ],
            requestedPeriodKey:
              "all",
          });

        expect(
          model.workspace
            .portfolio
            .accruedOperatingExpenses,
        ).toBe(1200);

        expect(
          model.workspace
            .portfolio.noi,
        ).toBe(3350);

        expect(
          model.obligationProjection
            .periodStart,
        ).toBe(
          "2025-01-01",
        );

        expect(
          model.obligationProjection
            .periodEnd,
        ).toBe(
          "2026-01-01",
        );
      },
    );
  },
);
