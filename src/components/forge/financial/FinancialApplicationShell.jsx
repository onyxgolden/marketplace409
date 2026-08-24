import ApplicationShell from "@/components/forge/workspace/ApplicationShell";
import FinancialExecutiveIntelligence from "@/components/forge/financial/FinancialExecutiveIntelligence";
import FinancialPositionSnapshot from "@/components/forge/financial/FinancialPositionSnapshot";
import FinancialTransactionsSurface from "@/components/forge/financial/FinancialTransactionsSurface";
import FinancialWorkspaceHeader from "@/components/forge/financial/FinancialWorkspaceHeader";
import FinancialWorkspaceSidebar from "@/components/forge/financial/FinancialWorkspaceSidebar";
import RentalPortfolioPerformance from "@/components/forge/property/RentalPortfolioPerformance";
import SimplifiImportPanel from "@/components/forge/financial/SimplifiImportPanel";

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
      id: "operations",
      label: "Operations",
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
  statusItems,
  activities,
  operations,
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

    case "operations":
      return (
        <FinancialWorkspaceSidebar
          statusItems={statusItems}
          activities={activities}
          operations={operations}
        />
      );

    case "import":
      return <SimplifiImportPanel />;

    case "overview":
    default:
      return (
        <div className="space-y-6">
          <FinancialWorkspaceHeader
            health={health}
            kpis={kpis}
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
            <section className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-900">
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
