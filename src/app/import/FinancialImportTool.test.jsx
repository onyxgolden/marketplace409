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
  "@/components/forge/TransactionReviewContainer",
  () => ({
    default: function TransactionReviewContainerStub() {
      return (
        <div data-transaction-review-container-stub />
      );
    },
  }),
);

import FinancialImportTool, {
  financialImportSurfaceClassName,
} from "./FinancialImportTool.jsx";

describe(
  "FinancialImportTool",
  () => {
    it(
      "stays compact until import results require review space",
      () => {
        const markup =
          renderToStaticMarkup(
            <FinancialImportTool />,
          );

        expect(markup).toContain(
          "data-financial-import-tool",
        );

        expect(markup).toContain(
          'data-import-result="empty"',
        );

        expect(markup).toContain(
          "max-w-3xl",
        );

        expect(markup).not.toContain(
          "max-w-[1800px]",
        );

        expect(
          financialImportSurfaceClassName(
            true,
          ),
        ).toContain(
          "max-w-[1800px]",
        );

        expect(
          financialImportSurfaceClassName(
            false,
          ),
        ).toContain(
          "max-w-3xl",
        );

        expect(
          financialImportSurfaceClassName(
            false,
          ),
        ).not.toContain(
          "mx-auto",
        );

        expect(
          financialImportSurfaceClassName(
            true,
          ),
        ).toContain(
          "mx-auto",
        );
      },
    );

    it(
      "renders a compact source and file step",
      () => {
        const markup =
          renderToStaticMarkup(
            <FinancialImportTool />,
          );

        expect(markup).toContain(
          "Financial Import",
        );

        expect(markup).toContain(
          "Import Source",
        );

        expect(markup).toContain(
          "Financial CSV File",
        );

        expect(markup).toContain(
          "lg:grid-cols-2",
        );

        expect(markup).not.toContain(
          "text-5xl",
        );

        expect(markup).toContain(
          "Rental records (Rentec CSV)",
        );

        expect(markup).toContain(
          "Financial records (QuickBooks CSV)",
        );

        expect(markup).toContain(
          "Imports a Rentec-formatted CSV",
        );
      },
    );
  },
);
