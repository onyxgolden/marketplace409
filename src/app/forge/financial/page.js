"use client";

import { useEffect, useState } from "react";
import {
  ForgeDashboardApplication,
  ForgeFinancialDashboardApplication,
} from "@/application/financial";
import ForgeDashboardCard from "@/components/forge/ForgeDashboardCard";
import ForgeExecutiveBriefing from "@/components/forge/ForgeExecutiveBriefing";
import ForgeExecutiveCopilot from "@/components/forge/ForgeExecutiveCopilot";
import ForgeInsights from "@/components/forge/ForgeInsights";
import ForgeRiskCenter from "@/components/forge/ForgeRiskCenter";
import ForgeNavigationBar from "@/components/forge/ForgeNavigationBar";
import ForgeRecentActivity from "@/components/forge/ForgeRecentActivity";
import ForgeSystemStatus from "@/components/forge/ForgeSystemStatus";
import FinancialWorkspaceSurface from "@/components/forge/workspace/views/FinancialWorkspaceSurface";
import RentalPortfolioPerformance from "@/components/forge/property/RentalPortfolioPerformance";
import { forgeTheme } from "@/components/forge/theme";

function cents(value) {
  return Number(value || 0);
}

function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents(value) / 100);
}

function percent(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function portfolioMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function displayPropertyName(propertyId) {
  if (!propertyId || propertyId === "unassigned") {
    return "Unassigned";
  }

  return propertyId
    .split("-")
    .filter(Boolean)
    .map(
      (part) =>
        part.charAt(0).toUpperCase() +
        part.slice(1),
    )
    .join(" ");
}

function displayCategory(category) {
  return String(category || "uncategorized")
    .split("_")
    .filter(Boolean)
    .map(
      (part) =>
        part.charAt(0).toUpperCase() +
        part.slice(1),
    )
    .join(" ");
}

export default function FinancialPage() {
  const [viewModel, setViewModel] = useState(
    ForgeFinancialDashboardApplication.buildLoadingModel(),
  );

  const [intelligenceModel, setIntelligenceModel] = useState(
    ForgeDashboardApplication.buildLoadingDashboardIntelligence(),
  );

  useEffect(() => {
    async function load() {
      const [
        result,
        intelligenceResult,
      ] = await Promise.all([
        ForgeFinancialDashboardApplication.load(),
        ForgeDashboardApplication.loadDashboardIntelligence(),
      ]);

      setViewModel(result);
      setIntelligenceModel(intelligenceResult);
    }

    load();
  }, []);

  const {
    riskSummary,
    riskAssessment,
    executiveBriefing,
    insightItems,
  } = intelligenceModel;

  const {
    operationsPlan,
    loadState,
    error,
    kpis,
    health,
    balanceSheetLines,
    portfolio,
    properties,
    categories,
    transactions,
    statusItems,
    activities,
  } = viewModel;

  const recentTransactions = [...transactions]
    .reverse()
    .slice(0, 8);

  const portfolioPresentation = portfolio
    ? {
        metrics: [
          {
            label: "Imported Income",
            value: portfolioMoney(portfolio.income),
          },
          {
            label: "Imported Expenses",
            value: portfolioMoney(portfolio.expenses),
          },
          {
            label: "NOI",
            value: portfolioMoney(portfolio.noi),
          },
          {
            label: "Cash Flow",
            value: portfolioMoney(portfolio.cashFlow),
          },
          {
            label: "Transactions",
            value: Number(
              portfolio.transactionCount || 0,
            ).toLocaleString(),
          },
        ],
      }
    : null;

  const propertyPresentations = properties.map(
    (property) => ({
      propertyId: property.propertyId,
      propertyName: displayPropertyName(
        property.propertyId,
      ),
      transactionCount: property.transactionCount,
      income: portfolioMoney(property.income),
      expenses: portfolioMoney(property.expenses),
      noi: portfolioMoney(property.noi),
      noiIsNegative: Number(property.noi) < 0,
      cashFlow: portfolioMoney(property.cashFlow),
      cashFlowIsNegative:
        Number(property.cashFlow) < 0,
    }),
  );

  const categoryPresentations = categories.map(
    (category) => ({
      category: category.category,
      label: displayCategory(category.category),
      value: portfolioMoney(category.netAmount),
      isNegative: Number(category.netAmount) < 0,
    }),
  );

  const recentTransactionPresentations =
    recentTransactions.map((transaction) => ({
      id: transaction.id,
      description: transaction.description,
      eventDate: transaction.eventDate,
      propertyName: displayPropertyName(
        transaction.propertyId,
      ),
      amount: portfolioMoney(transaction.amount),
      isIncome:
        transaction.transactionKind === "income",
      categoryLabel: displayCategory(
        transaction.category,
      ),
      sourceSystem: transaction.sourceSystem,
    }));

  return (
    <div className={forgeTheme.page}>
      <main className="mx-auto min-h-screen max-w-[1600px] space-y-6 p-4 lg:p-8">
        <ForgeNavigationBar />
        <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm lg:p-8">
          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
            <div>
              <div className={forgeTheme.labelSmall}>FORGE Financial Command</div>
              <h1 className="mt-3 text-4xl font-black tracking-tight text-slate-950">
                Executive KPI Dashboard
              </h1>
              <p className="mt-3 max-w-3xl text-slate-600">
                Financial performance, cash position, equity, and operating margin
                surfaced from the FORGE financial engine and dashboard domain service.
              </p>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
              <div className="text-xs font-black uppercase tracking-wide text-amber-700">
                Health Status
              </div>
              <div className="mt-1 text-2xl font-black text-amber-950">
                {health.label}
              </div>
              <div className="mt-1 max-w-xs text-sm text-amber-800">
                {health.detail}
              </div>
            </div>
          </div>
        </section>

        {loadState === "error" && (
          <section className="rounded-3xl border border-red-200 bg-red-50 p-6 text-red-900">
            <div className="font-black">Financial dashboard failed to load.</div>
            <div className="mt-2 text-sm">{error}</div>
          </section>
        )}

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <ForgeDashboardCard
            label="Net Worth / Equity"
            value={money(kpis.equity)}
            detail={`Assets ${money(kpis.assets)} · Liabilities ${money(kpis.liabilities)}`}
          />
          <ForgeDashboardCard
            label="Cash"
            value={money(kpis.cash)}
            detail={`Receivables ${money(kpis.receivables)}`}
          />
          <ForgeDashboardCard
            label="Monthly Profit"
            value={money(kpis.profit)}
            detail={`Revenue ${money(kpis.revenue)} · Expenses ${money(kpis.expenses)}`}
          />
          <ForgeDashboardCard
            label="Profit Margin"
            value={percent(kpis.margin)}
            detail="Revenue retained after expenses"
          />
        </section>

        <FinancialWorkspaceSurface
          executive={
            <>
              <ForgeExecutiveBriefing
                executiveBriefing={
                  executiveBriefing || {
                    headline: "Loading executive briefing",
                    overview: "Dashboard intelligence is loading.",
                    outlook: "Preparing financial outlook.",
                  }
                }
                riskAssessment={
                  riskAssessment || {
                    recommendations: [],
                  }
                }
              />

              <ForgeRiskCenter
                riskSummary={
                  riskSummary || {
                    status: "Loading",
                    score: 0,
                    summary: "Risk assessment is loading.",
                  }
                }
                riskAssessment={
                  riskAssessment || {
                    primaryDrivers: [],
                    trendIndicators: [],
                    recommendations: [],
                  }
                }
              />

              <ForgeInsights insights={insightItems || []} />

              <ForgeExecutiveCopilot
                executiveBriefing={
                  executiveBriefing || {
                    outlook: "Preparing financial outlook.",
                  }
                }
                riskAssessment={
                  riskAssessment || {
                    recommendations: [],
                  }
                }
              />
            </>
          }
        />

        <FinancialWorkspaceSurface
          portfolio={
              <>
            <section className={forgeTheme.card}>
              <div className={forgeTheme.labelSmall}>Financial Statement</div>
              <h2 className="mt-2 text-2xl font-black text-slate-950">
                Balance Sheet Snapshot
              </h2>

              <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
                <table className="w-full border-collapse text-left">
                  <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="p-4">Account</th>
                      <th className="p-4 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {balanceSheetLines.map((line) => (
                      <tr key={line.accountId}>
                        <td className="p-4 font-bold text-slate-800">
                          {line.accountName}
                        </td>
                        <td className="p-4 text-right font-black text-slate-950">
                          {money(line.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <RentalPortfolioPerformance
              loadState={loadState}
              portfolio={portfolioPresentation}
              properties={propertyPresentations}
              categories={categoryPresentations}
              recentTransactions={
                recentTransactionPresentations
              }
            />
              </>
          }
          sidebar={
            <>
              <ForgeSystemStatus statusItems={statusItems} />
            <ForgeRecentActivity activities={activities} />

            <section className={forgeTheme.cardCompact}>
              <div className={forgeTheme.labelSmall}>Financial Operations</div>
              <h2 className="mt-2 text-xl font-black text-slate-950">
                {operationsPlan?.focus || "Operations Plan"}
              </h2>
              <p className="mt-3 text-sm text-slate-600">
                {operationsPlan?.summary ||
                  "Financial operations guidance is loading."}
              </p>

              <div className="mt-4 rounded-2xl bg-slate-100 p-4">
                <div className="text-xs font-black uppercase tracking-wide text-slate-500">
                  Priority
                </div>
                <div className="mt-1 text-lg font-black capitalize text-slate-950">
                  {operationsPlan?.priority || "monitor"}
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {(operationsPlan?.actions || []).slice(0, 3).map((action) => (
                  <div
                    key={action.id}
                    className="rounded-2xl border border-slate-200 p-4"
                  >
                    <div className="font-black text-slate-900">
                      {action.title}
                    </div>
                    <div className="mt-1 text-xs uppercase tracking-wide text-slate-500">
                      {action.status} · {action.priority}
                    </div>
                    <div className="mt-2 text-sm text-slate-600">
                      {action.rationale}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className={forgeTheme.cardCompact}>
              <div className={forgeTheme.labelSmall}>Phase Guardrails</div>
              <div className="mt-3 space-y-3 text-sm text-slate-600">
                <p>Rental portfolio activity is now displayed from persisted financial events.</p>
                <p>Plaid, brokerage, valuation, and Stripe integrations remain behind the provider boundary.</p>
                <p>Financial calculations stay in the domain layer, not React components.</p>
              </div>
            </section>
            </>
          }
        />
      </main>
    </div>
  );
}
