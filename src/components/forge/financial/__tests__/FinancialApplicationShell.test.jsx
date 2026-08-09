import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  renderToStaticMarkup,
} from "react-dom/server";

vi.mock(
  "../FinancialWorkspaceHeader",
  () => ({
    default: function MockHeader() {
      return (
        <section data-overview-header>
          Overview header
        </section>
      );
    },
  }),
);

vi.mock(
  "../FinancialExecutiveIntelligence",
  () => ({
    default: function MockIntelligence() {
      return (
        <section data-overview-intelligence>
          Executive intelligence
        </section>
      );
    },
  }),
);

vi.mock(
  "../FinancialPositionSnapshot",
  () => ({
    default: function MockPosition() {
      return (
        <section data-overview-position>
          Position snapshot
        </section>
      );
    },
  }),
);

vi.mock(
  "../FinancialTransactionsSurface",
  () => ({
    default: function MockTransactions() {
      return (
        <section data-transactions-function>
          Transaction function
        </section>
      );
    },
  }),
);

vi.mock(
  "@/components/forge/property/RentalPortfolioPerformance",
  () => ({
    default: function MockProperties() {
      return (
        <section data-properties-function>
          Properties function
        </section>
      );
    },
  }),
);

vi.mock(
  "../FinancialWorkspaceSidebar",
  () => ({
    default: function MockOperations() {
      return (
        <section data-operations-function>
          Operations function
        </section>
      );
    },
  }),
);

import FinancialApplicationShell, {
  FINANCIAL_FUNCTIONS,
} from "../FinancialApplicationShell.jsx";

function renderFunction(
  activeFunctionId,
) {
  return renderToStaticMarkup(
    <FinancialApplicationShell
      activeFunctionId={
        activeFunctionId
      }
    />,
  );
}

describe(
  "FinancialApplicationShell",
  () => {
    it(
      "defines the first focused Financial function set",
      () => {
        expect(
          FINANCIAL_FUNCTIONS,
        ).toEqual([
          {
            id: "overview",
            label: "Overview",
          },
          {
            id: "transactions",
            label: "Transactions",
          },
          {
            id: "properties",
            label: "Properties",
          },
          {
            id: "operations",
            label: "Operations",
          },
        ]);
      },
    );

    it.each([
      [
        "overview",
        "data-overview-header",
      ],
      [
        "transactions",
        "data-transactions-function",
      ],
      [
        "properties",
        "data-properties-function",
      ],
      [
        "operations",
        "data-operations-function",
      ],
    ])(
      "renders only the %s function surface",
      (
        activeFunctionId,
        expectedMarker,
      ) => {
        const markup =
          renderFunction(
            activeFunctionId,
          );

        expect(markup).toContain(
          `data-active-function="${activeFunctionId}"`,
        );

        expect(markup).toContain(
          expectedMarker,
        );

        const allMarkers = [
          "data-overview-header",
          "data-transactions-function",
          "data-properties-function",
          "data-operations-function",
        ];

        for (
          const marker of allMarkers
        ) {
          if (
            marker !==
            expectedMarker
          ) {
            expect(markup).not
              .toContain(marker);
          }
        }
      },
    );
  },
);
