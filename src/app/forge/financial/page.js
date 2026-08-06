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

            <section className={forgeTheme.card}>
              <div className={forgeTheme.labelSmall}>
                Repository-Backed Rental Activity
              </div>

              <div className="mt-2 flex flex-col justify-between gap-3 md:flex-row md:items-end">
                <div>
                  <h2 className="text-2xl font-black text-slate-950">
                    Rental Portfolio Summary
                  </h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                    Actual imported income and expenses grouped from your
                    persisted financial events. No property values, occupancy,
                    loan balances, or forecasts are inferred here.
                  </p>
                </div>

                <div className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-black uppercase tracking-wide text-emerald-800">
                  Repository Backed
                </div>
              </div>

              {loadState === "loading" && (
                <div className="mt-6 rounded-2xl bg-slate-100 p-6 text-sm font-bold text-slate-600">
                  Loading rental portfolio activity...
                </div>
              )}

              {loadState === "ready" && !portfolio && (
                <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-6">
                  <div className="font-black text-slate-900">
                    No rental portfolio data is available yet.
                  </div>
                  <div className="mt-2 text-sm text-slate-600">
                    Import a Rentec financial file to populate this summary.
                  </div>
                </div>
              )}

              {portfolio && (
                <>
                  <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
                    {[
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
                    ].map((metric) => (
                      <div
                        key={metric.label}
                        className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                      >
                        <div className={forgeTheme.labelSmall}>
                          {metric.label}
                        </div>
                        <div className="mt-2 text-2xl font-black text-slate-950">
                          {metric.value}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-8">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className={forgeTheme.labelSmall}>
                          Properties
                        </div>
                        <h3 className="mt-1 text-xl font-black text-slate-950">
                          Imported Property Performance
                        </h3>
                      </div>

                      <div className="text-sm font-bold text-slate-500">
                        {properties.length}{" "}
                        {properties.length === 1
                          ? "property"
                          : "properties"}
                      </div>
                    </div>

                    {properties.length === 0 ? (
                      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
                        No property-linked financial events were found.
                      </div>
                    ) : (
                      <div className="mt-4 grid gap-4 lg:grid-cols-2">
                        {properties.map((property) => (
                          <article
                            key={property.propertyId}
                            className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <div className="text-xs font-black uppercase tracking-wide text-slate-500">
                                  Rental Property
                                </div>
                                <h4 className="mt-1 text-xl font-black text-slate-950">
                                  {displayPropertyName(
                                    property.propertyId,
                                  )}
                                </h4>
                              </div>

                              <div className="rounded-full bg-slate-100 px-3 py-2 text-xs font-black text-slate-700">
                                {property.transactionCount} transactions
                              </div>
                            </div>

                            <div className="mt-5 grid grid-cols-2 gap-3">
                              <div className="rounded-2xl bg-emerald-50 p-4">
                                <div className="text-xs font-black uppercase tracking-wide text-emerald-700">
                                  Income
                                </div>
                                <div className="mt-1 text-lg font-black text-emerald-950">
                                  {portfolioMoney(property.income)}
                                </div>
                              </div>

                              <div className="rounded-2xl bg-rose-50 p-4">
                                <div className="text-xs font-black uppercase tracking-wide text-rose-700">
                                  Expenses
                                </div>
                                <div className="mt-1 text-lg font-black text-rose-950">
                                  {portfolioMoney(property.expenses)}
                                </div>
                              </div>

                              <div className="rounded-2xl bg-amber-50 p-4">
                                <div className="text-xs font-black uppercase tracking-wide text-amber-700">
                                  NOI
                                </div>
                                <div className="mt-1 text-lg font-black text-amber-950">
                                  {portfolioMoney(property.noi)}
                                </div>
                              </div>

                              <div className="rounded-2xl bg-sky-50 p-4">
                                <div className="text-xs font-black uppercase tracking-wide text-sky-700">
                                  Cash Flow
                                </div>
                                <div className="mt-1 text-lg font-black text-sky-950">
                                  {portfolioMoney(property.cashFlow)}
                                </div>
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="mt-8 grid gap-6 xl:grid-cols-2">
                    <div>
                      <div className={forgeTheme.labelSmall}>
                        Categories
                      </div>
                      <h3 className="mt-1 text-xl font-black text-slate-950">
                        Income and Expense Breakdown
                      </h3>

                      <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
                        <table className="w-full border-collapse text-left text-sm">
                          <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-500">
                            <tr>
                              <th className="p-3">Category</th>
                              <th className="p-3 text-right">
                                Net
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {categories.length === 0 ? (
                              <tr>
                                <td
                                  colSpan={2}
                                  className="p-5 text-slate-500"
                                >
                                  No categorized activity yet.
                                </td>
                              </tr>
                            ) : (
                              categories.map((category) => (
                                <tr key={category.category}>
                                  <td className="p-3 font-bold text-slate-800">
                                    {displayCategory(
                                      category.category,
                                    )}
                                  </td>
                                  <td
                                    className={`p-3 text-right font-black ${
                                      category.netAmount >= 0
                                        ? "text-emerald-700"
                                        : "text-rose-700"
                                    }`}
                                  >
                                    {portfolioMoney(
                                      category.netAmount,
                                    )}
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div>
                      <div className={forgeTheme.labelSmall}>
                        Recent Imported Activity
                      </div>
                      <h3 className="mt-1 text-xl font-black text-slate-950">
                        Latest Financial Events
                      </h3>

                      <div className="mt-4 space-y-3">
                        {recentTransactions.length === 0 ? (
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
                            No imported financial activity yet.
                          </div>
                        ) : (
                          recentTransactions.map((transaction) => (
                            <div
                              key={transaction.id}
                              className="rounded-2xl border border-slate-200 bg-white p-4"
                            >
                              <div className="flex items-start justify-between gap-4">
                                <div>
                                  <div className="font-black text-slate-900">
                                    {transaction.description}
                                  </div>
                                  <div className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-500">
                                    {transaction.eventDate} ·{" "}
                                    {displayPropertyName(
                                      transaction.propertyId,
                                    )}
                                  </div>
                                </div>

                                <div
                                  className={`font-black ${
                                    transaction.transactionKind ===
                                    "income"
                                      ? "text-emerald-700"
                                      : "text-rose-700"
                                  }`}
                                >
                                  {transaction.transactionKind ===
                                  "income"
                                    ? "+"
                                    : "-"}
                                  {portfolioMoney(
                                    transaction.amount,
                                  )}
                                </div>
                              </div>

                              <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
                                <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
                                  {displayCategory(
                                    transaction.category,
                                  )}
                                </span>
                                <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
                                  {transaction.sourceSystem}
                                </span>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </section>
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
