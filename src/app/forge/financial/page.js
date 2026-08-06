"use client";

import { useEffect, useState } from "react";
import {
  ForgeDashboardApplication,
  ForgeFinancialDashboardApplication,
} from "@/application/financial";
import FinancialWorkspaceHeader from "@/components/forge/financial/FinancialWorkspaceHeader";
import ForgeExecutiveBriefing from "@/components/forge/ForgeExecutiveBriefing";
import ForgeExecutiveCopilot from "@/components/forge/ForgeExecutiveCopilot";
import ForgeInsights from "@/components/forge/ForgeInsights";
import ForgeRiskCenter from "@/components/forge/ForgeRiskCenter";
import ForgeNavigationBar from "@/components/forge/ForgeNavigationBar";
import FinancialWorkspaceSurface from "@/components/forge/workspace/views/FinancialWorkspaceSurface";
import RentalPortfolioPerformance from "@/components/forge/property/RentalPortfolioPerformance";
import FinancialPositionSnapshot from "@/components/forge/financial/FinancialPositionSnapshot";
import FinancialWorkspaceSidebar from "@/components/forge/financial/FinancialWorkspaceSidebar";
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

  const balanceSheetPresentations =
    balanceSheetLines.map((line) => ({
      accountId: line.accountId,
      accountName: line.accountName,
      amount: money(line.amount),
      isNegative: Number(line.amount) < 0,
    }));

  const operationsPresentation = {
    focus: operationsPlan?.focus || "Operations Plan",
    summary:
      operationsPlan?.summary ||
      "Financial operations guidance is loading.",
    priority: operationsPlan?.priority || "monitor",
    actions: (operationsPlan?.actions || [])
      .slice(0, 3)
      .map((action) => ({
        id: action.id,
        title: action.title,
        status: action.status,
        priority: action.priority,
        rationale: action.rationale,
      })),
  };

  const kpiPresentations = [
    {
      id: "equity",
      label: "Net Worth / Equity",
      value: money(kpis.equity),
      detail:
        `Assets ${money(kpis.assets)} · ` +
        `Liabilities ${money(kpis.liabilities)}`,
    },
    {
      id: "cash",
      label: "Cash",
      value: money(kpis.cash),
      detail: `Receivables ${money(kpis.receivables)}`,
    },
    {
      id: "profit",
      label: "Monthly Profit",
      value: money(kpis.profit),
      detail:
        `Revenue ${money(kpis.revenue)} · ` +
        `Expenses ${money(kpis.expenses)}`,
    },
    {
      id: "margin",
      label: "Profit Margin",
      value: percent(kpis.margin),
      detail: "Revenue retained after expenses",
    },
  ];

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
        <FinancialWorkspaceHeader
          health={health}
          kpis={kpiPresentations}
        />

        {loadState === "error" && (
          <section className="rounded-3xl border border-red-200 bg-red-50 p-6 text-red-900">
            <div className="font-black">Financial dashboard failed to load.</div>
            <div className="mt-2 text-sm">{error}</div>
          </section>
        )}

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
            <FinancialPositionSnapshot
              lines={balanceSheetPresentations}
            />

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
            <FinancialWorkspaceSidebar
              statusItems={statusItems}
              activities={activities}
              operations={operationsPresentation}
            />
          }
        />
      </main>
    </div>
  );
}
