import { useState } from "react";
import ApplicationShell from "@/components/forge/workspace/ApplicationShell";
import FinancialExecutiveIntelligence from "@/components/forge/financial/FinancialExecutiveIntelligence";
import FinancialForgeOverviewPanel from "@/components/forge/financial/FinancialForgeOverviewPanel";
import FinancialAccountBalancesPanel from "@/components/forge/financial/FinancialAccountBalancesPanel";
import FinancialPositionSnapshot from "@/components/forge/financial/FinancialPositionSnapshot";
import FinancialTransactionsSurface from "@/components/forge/financial/FinancialTransactionsSurface";
import FinancialWorkspaceHeader from "@/components/forge/financial/FinancialWorkspaceHeader";
import FinancialWorkspaceSidebar from "@/components/forge/financial/FinancialWorkspaceSidebar";
import RentalPortfolioPerformance from "@/components/forge/property/RentalPortfolioPerformance";
import SimplifiImportPanel from "@/components/forge/financial/SimplifiImportPanel";
import FinancialAssetsPanel from "@/components/forge/financial/FinancialAssetsPanel";
import InvestmentAccountsPanel from "@/components/forge/financial/InvestmentAccountsPanel";
import FinancialLoanToolsPanel from "@/components/forge/financial/FinancialLoanToolsPanel";
import FinancialWelcomeOnboarding from "@/components/forge/financial/FinancialWelcomeOnboarding";

export const FINANCIAL_FUNCTIONS =
  Object.freeze([
    Object.freeze({
      id: "overview",
      label: "Overview",
    }),
    Object.freeze({
      id: "transactions",
      label: "Transactions",
    }),
    Object.freeze({
      id: "properties",
      label: "Properties",
    }),
    Object.freeze({
      id: "assets",
      label: "Assets",
    }),
    Object.freeze({
      id: "investments",
      label: "Investments",
    }),
    Object.freeze({
      id: "operations",
      label: "Operations",
    }),
    Object.freeze({
      id: "tools",
      label: "Tools",
    }),
    Object.freeze({
      id: "import",
      label: "Import",
    }),
  ]);

export function buildFinancialActiveSurface({
  activeFunctionId,
  loadState,
  health,
  kpis,
  executiveBriefing,
  riskSummary,
  riskAssessment,
  insights,
  balanceSheetLines,
  portfolio,
  periodOptions,
  selectedPeriodKey,
  selectedPeriodLabel,
  onPeriodChange,
  properties,
  categories,
  transactions,
  allScopeTransactions,
  allScopeTransactionPresentations,
  accounts,
  statusItems,
  activities,
  operations,
  compareMonthsSection = null,
  selectedAccountId = null,
  selectedAccountName = null,
  onSelectAccount,
  onClearSelectedAccount,
  onFunctionChange,
}) {
  switch (activeFunctionId) {
    case "transactions":
      return (
        <FinancialTransactionsSurface
          loadState={loadState}
          transactions={transactions}
        />
      );

    case "properties":
      return (
        <RentalPortfolioPerformance
          loadState={loadState}
          portfolio={portfolio}
          periodOptions={
            periodOptions
          }
          selectedPeriodKey={
            selectedPeriodKey
          }
          selectedPeriodLabel={
            selectedPeriodLabel
          }
          onPeriodChange={
            onPeriodChange
          }
          properties={properties}
          categories={categories}
          recentTransactions={
            transactions
          }
        />
      );

    case "assets":
      return <FinancialAssetsPanel />;

    case "investments":
      return <InvestmentAccountsPanel />;

    case "operations":
      return (
        <FinancialWorkspaceSidebar
          statusItems={statusItems}
          activities={activities}
          operations={operations}
        />
      );

    case "tools":
      return <FinancialLoanToolsPanel />;

    case "import":
      return <SimplifiImportPanel />;

    case "overview":
    default: {
      // Clicking a leaf (non-rolled-up) account row in the Accounts panel replaces this right-hand
      // column with that account's own activity -- every financial_events row carrying its id,
      // newest first -- instead of the normal overview stack. onClearSelectedAccount (the surface's
      // own "Back to overview" control) is how you get back. Filters allScopeTransactionPresentations
      // (already shaped for FinancialTransactionsSurface -- categoryLabel/isIncome/formatted amount),
      // NOT raw allScopeTransactions, which FinancialForgeOverviewPanel below still needs unshaped.
      const selectedAccountTransactions = selectedAccountId
        ? (allScopeTransactionPresentations || [])
            .filter((event) => event.financialAccountId === selectedAccountId)
            .sort((a, b) => String(b.eventDate || "").localeCompare(String(a.eventDate || "")))
        : [];

      // Loaded, real data, and genuinely zero financial_accounts -- never during a loading or
      // error state, which have their own handling and shouldn't flash the welcome screen.
      const showWelcome = loadState === "ready" && (accounts || []).length === 0;

      return (
        <div className="space-y-6">
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
            <div className="lg:sticky lg:top-4">
              <FinancialAccountBalancesPanel
                onSelectAccount={onSelectAccount}
                selectedAccountId={selectedAccountId}
              />
            </div>

            <div className="min-w-0 space-y-6">
              {selectedAccountId ? (
                <FinancialTransactionsSurface
                  loadState={loadState}
                  transactions={selectedAccountTransactions}
                  accountName={selectedAccountName}
                  onBack={onClearSelectedAccount}
                />
              ) : showWelcome ? (
                <FinancialWelcomeOnboarding
                  onNavigateToImport={() => onFunctionChange?.("import")}
                />
              ) : (
                <>
                  <FinancialForgeOverviewPanel
                    loadState={loadState}
                    transactions={allScopeTransactions}
                    accounts={accounts}
                  />

                  <FinancialExecutiveIntelligence
                    executiveBriefing={
                      executiveBriefing
                    }
                    riskSummary={riskSummary}
                    riskAssessment={
                      riskAssessment
                    }
                    insights={insights}
                  />

                  <FinancialPositionSnapshot
                    lines={balanceSheetLines}
                  />

                  {compareMonthsSection}
                </>
              )}
            </div>
          </div>

          {!showWelcome && (
            <FinancialWorkspaceHeader
              health={health}
              kpis={kpis}
            />
          )}
        </div>
      );
    }
  }
}

export default function FinancialApplicationShell({
  activeFunctionId,
  onFunctionChange,
  error = null,
  isRefreshing = false,
  ...presentation
}) {
  const [selectedAccount, setSelectedAccount] = useState(null);

  const activeSurface =
    buildFinancialActiveSurface({
      activeFunctionId,
      onFunctionChange,
      ...presentation,
      selectedAccountId: selectedAccount?.id ?? null,
      selectedAccountName: selectedAccount?.name ?? null,
      // Clicking the already-selected account again clears the filter, same as the explicit
      // "Back to overview" control -- a second, low-friction way back.
      onSelectAccount: (id, name) => setSelectedAccount((current) => (current?.id === id ? null : { id, name })),
      onClearSelectedAccount: () => setSelectedAccount(null),
    });

  return (
    <ApplicationShell
      applicationName="Financial"
      applicationDescription="Financial position, transactions, property performance, and operating actions."
      functions={FINANCIAL_FUNCTIONS}
      sidebarKey="financial"
      activeFunctionId={
        activeFunctionId
      }
      onFunctionChange={
        onFunctionChange
      }
      activeSurface={
        <div className="space-y-5">
          {isRefreshing && !error && (
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
              Refreshing with the latest data&hellip;
            </p>
          )}

          {error && (
            <section className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-900 dark:border-red-800/50 dark:bg-red-950/30 dark:text-red-300">
              <div className="font-black">
                Financial data failed to load.
              </div>

              <div className="mt-2 text-sm">
                {error}
              </div>
            </section>
          )}

          {activeSurface}
        </div>
      }
    />
  );
}
