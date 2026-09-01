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
  accounts,
  statusItems,
  activities,
  operations,
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
    default:
      return (
        <div className="space-y-6">
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
            <div className="lg:sticky lg:top-4">
          <FinancialAccountBalancesPanel onEditAsset={() => onFunctionChange?.("assets")} />
            </div>

            <div className="min-w-0 space-y-6">
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
            </div>
          </div>

          <FinancialWorkspaceHeader
            health={health}
            kpis={kpis}
          />
        </div>
      );
  }
}

export default function FinancialApplicationShell({
  activeFunctionId,
  onFunctionChange,
  error = null,
  ...presentation
}) {
  const activeSurface =
    buildFinancialActiveSurface({
      activeFunctionId,
      onFunctionChange,
      ...presentation,
    });

  return (
    <ApplicationShell
      applicationName="Financial"
      applicationDescription="Financial position, transactions, property performance, and operating actions."
      functions={FINANCIAL_FUNCTIONS}
      activeFunctionId={
        activeFunctionId
      }
      onFunctionChange={
        onFunctionChange
      }
      activeSurface={
        <div className="space-y-5">
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
