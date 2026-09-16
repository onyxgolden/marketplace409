// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  renderToStaticMarkup,
} from "react-dom/server";

import FinancialTransactionsSurface from "../FinancialTransactionsSurface.jsx";

let mounted = null;
function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(ui); });
  return { container, root };
}
afterEach(() => {
  if (mounted) {
    act(() => { mounted.root.unmount(); });
    mounted.container.remove();
    mounted = null;
  }
});

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

    it("labels a manual-source transaction as \"Manual entry\" instead of the raw source_system string", () => {
      const markup = renderToStaticMarkup(
        <FinancialTransactionsSurface
          transactions={[{ id: "t-1", eventDate: "2026-08-01", description: "Owner deposit", sourceSystem: "manual", amount: "$500.00", isIncome: true }]}
        />,
      );
      expect(markup).toContain("Manual entry");
      expect(markup).not.toContain(">manual<");
    });

    it("shows the account name as the heading and a Back to overview control when accountName is provided", () => {
      mounted = mount(
        <FinancialTransactionsSurface
          transactions={[]}
          accountName="Business Checking"
          onBack={() => {}}
        />,
      );
      expect(mounted.container.querySelector("[data-financial-activity-heading]").textContent).toBe("Business Checking");
      expect(mounted.container.textContent).toContain("Every transaction that makes up this account's balance, newest first.");
      expect(mounted.container.textContent).toContain("Back to overview");
    });

    it("calls onBack when the Back to overview control is clicked", () => {
      const onBack = vi.fn();
      mounted = mount(
        <FinancialTransactionsSurface transactions={[]} accountName="Business Checking" onBack={onBack} />,
      );
      const backButton = Array.from(mounted.container.querySelectorAll("button")).find((button) => button.textContent.includes("Back to overview"));
      act(() => { backButton.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      expect(onBack).toHaveBeenCalledTimes(1);
    });

    it("shows no Back control and the default heading when accountName/onBack are not provided", () => {
      mounted = mount(<FinancialTransactionsSurface transactions={[]} />);
      expect(mounted.container.querySelector("[data-financial-activity-heading]").textContent).toBe("Recent transactions");
      expect(mounted.container.textContent).not.toContain("Back to overview");
    });
  },
);
