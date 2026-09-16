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

vi.mock("../SimplifiImportPanel", () => ({
  default: function MockSimplifiImport() { return <section data-simplifi-import-function>Simplifi import</section>; },
}));

vi.mock("../FinancialAssetsPanel", () => ({
  default: function MockAssets() { return <section data-assets-function>Assets</section>; },
}));

vi.mock("../InvestmentAccountsPanel", () => ({
  default: function MockInvestments() { return <section data-investments-function>Investments</section>; },
}));

vi.mock("../FinancialLoanToolsPanel", () => ({
  default: function MockTools() { return <section data-tools-function>Loan tools</section>; },
}));

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
    default: function MockTransactions({ transactions = [], accountName = null, onBack = null }) {
      return (
        <section data-transactions-function data-account-name={accountName || undefined}>
          Transaction function
          <ul data-mock-transaction-ids>
            {transactions.map((transaction) => (
              <li key={transaction.id} data-income={transaction.isIncome || undefined}>
                {transaction.id} {transaction.categoryLabel} {transaction.amount}
              </li>
            ))}
          </ul>
          {onBack && <button type="button" data-mock-back onClick={onBack}>Back</button>}
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
            id: "assets",
            label: "Assets",
          },
          {
            id: "investments",
            label: "Investments",
          },
          {
            id: "operations",
            label: "Operations",
          },
          {
            id: "tools",
            label: "Tools",
          },
          {
            id: "import",
            label: "Import",
          },
        ]);
      },
    );

    it.each([
      [
        "overview",
        "data-financial-forge-overview",
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
        "assets",
        "data-assets-function",
      ],
      [
        "investments",
        "data-investments-function",
      ],
      [
        "operations",
        "data-operations-function",
      ],
      [
        "tools",
        "data-tools-function",
      ],
      [
        "import",
        "data-simplifi-import-function",
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
          "data-financial-forge-overview",
          "data-transactions-function",
          "data-properties-function",
          "data-assets-function",
          "data-investments-function",
          "data-operations-function",
          "data-tools-function",
          "data-simplifi-import-function",
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

    it("passes sidebarKey=\"financial\" through to ApplicationShell, so the Customize control renders", () => {
      const markup = renderFunction("overview");
      expect(markup).toContain("Customize");
    });

    describe("clicking an account replaces the overview with its filtered activity", () => {
      let mounted;

      function mount(ui) {
        const container = document.createElement("div");
        document.body.appendChild(container);
        const root = createRoot(container);
        act(() => { root.render(ui); });
        return { container, root };
      }
      async function flush() {
        await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
      }
      function stubAccountBalancesFetch() {
        vi.stubGlobal("fetch", vi.fn(async (url) => {
          if (url === "/api/financial/account-balances") {
            return {
              ok: true,
              json: async () => ({
                success: true,
                accounts: [{ id: "acct-bank", name: "Business Checking", type: "depository", kind: "asset", latestBalance: { currentBalanceCents: 100000, asOf: "2026-08-01", provider: "manual", editable: true } }],
              }),
            };
          }
          return { ok: true, json: async () => ({ success: true, accounts: [], assets: [] }) };
        }));
      }

      afterEach(() => {
        if (mounted) { act(() => { mounted.root.unmount(); }); mounted.container.remove(); mounted = null; }
        vi.unstubAllGlobals();
      });

      it("filters allScopeTransactionPresentations to the clicked account, sorted newest-first, with real display fields intact, and shows its name; Back restores the overview", async () => {
        stubAccountBalancesFetch();
        // Realistic presentation shape (as produced by page.js's presentTransaction()), not raw
        // financial-event fields -- this is the exact shape mismatch that made every account's
        // activity list render blank before this fix, regardless of account or provider.
        const allScopeTransactionPresentations = [
          {
            id: "tx-old", financialAccountId: "acct-bank", eventDate: "2026-07-01",
            categoryLabel: "Office Supplies", amount: "$42.00", isIncome: false,
          },
          {
            id: "tx-new", financialAccountId: "acct-bank", eventDate: "2026-08-15",
            categoryLabel: "Rent Collected", amount: "$1,500.00", isIncome: true,
          },
          {
            id: "tx-other-account", financialAccountId: "acct-other", eventDate: "2026-08-20",
            categoryLabel: "Other", amount: "$10.00", isIncome: false,
          },
        ];
        mounted = mount(<FinancialApplicationShell activeFunctionId="overview" allScopeTransactionPresentations={allScopeTransactionPresentations} />);
        await flush();

        expect(mounted.container.querySelector("[data-financial-forge-overview]")).not.toBeNull();
        expect(mounted.container.querySelector("[data-transactions-function]")).toBeNull();

        const bankingGroup = mounted.container.querySelector('[data-account-category="banking"]');
        act(() => { bankingGroup.querySelector("button").dispatchEvent(new MouseEvent("click", { bubbles: true })); });
        const accountButton = mounted.container.querySelector('[data-account-balance-row="acct-bank"] button');
        act(() => { accountButton.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

        expect(mounted.container.querySelector("[data-financial-forge-overview]")).toBeNull();
        const surface = mounted.container.querySelector("[data-transactions-function]");
        expect(surface).not.toBeNull();
        expect(surface.getAttribute("data-account-name")).toBe("Business Checking");
        const rows = Array.from(surface.querySelectorAll("[data-mock-transaction-ids] li"));
        expect(rows.map((li) => li.textContent)).toEqual(["tx-new Rent Collected $1,500.00", "tx-old Office Supplies $42.00"]);
        expect(rows[0].getAttribute("data-income")).toBe("true");
        expect(rows[1].hasAttribute("data-income")).toBe(false);

        const backButton = surface.querySelector("[data-mock-back]");
        act(() => { backButton.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

        expect(mounted.container.querySelector("[data-financial-forge-overview]")).not.toBeNull();
        expect(mounted.container.querySelector("[data-transactions-function]")).toBeNull();
      });

      it("clicking the same account again clears the selection, same as Back", async () => {
        stubAccountBalancesFetch();
        mounted = mount(<FinancialApplicationShell activeFunctionId="overview" allScopeTransactionPresentations={[]} />);
        await flush();

        const bankingGroup = mounted.container.querySelector('[data-account-category="banking"]');
        act(() => { bankingGroup.querySelector("button").dispatchEvent(new MouseEvent("click", { bubbles: true })); });
        const accountButton = mounted.container.querySelector('[data-account-balance-row="acct-bank"] button');
        act(() => { accountButton.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
        expect(mounted.container.querySelector("[data-transactions-function]")).not.toBeNull();

        act(() => { mounted.container.querySelector('[data-account-balance-row="acct-bank"] button').dispatchEvent(new MouseEvent("click", { bubbles: true })); });
        expect(mounted.container.querySelector("[data-transactions-function]")).toBeNull();
        expect(mounted.container.querySelector("[data-financial-forge-overview]")).not.toBeNull();
      });
    });
  },
);
