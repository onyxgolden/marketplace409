"use client";

import { useEffect, useState } from "react";
import {
  ForgeDashboardApplication,
  ForgeFinancialDashboardApplication,
} from "@/application/financial";
import FinancialApplicationShell from "@/components/forge/financial/FinancialApplicationShell";

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

  const [
    activeFunctionId,
    setActiveFunctionId,
  ] = useState("overview");

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
  } =
    ForgeDashboardApplication.buildViewModel(
      intelligenceModel,
    );

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

  const executiveBriefingPresentation =
    executiveBriefing || {
      headline: "Loading executive briefing",
      overview: "Dashboard intelligence is loading.",
      outlook: "Preparing financial outlook.",
    };

  const riskSummaryPresentation =
    riskSummary || {
      status: "Loading",
      score: 0,
      summary: "Risk assessment is loading.",
    };

  const riskAssessmentPresentation =
    riskAssessment || {
      primaryDrivers: [],
      trendIndicators: [],
      recommendations: [],
    };

  const insightPresentations = insightItems || [];

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
    <FinancialApplicationShell
      activeFunctionId={
        activeFunctionId
      }
      onFunctionChange={
        setActiveFunctionId
      }
      loadState={loadState}
      error={
        loadState === "error"
          ? error
          : null
      }
      health={health}
      kpis={kpiPresentations}
      executiveBriefing={
        executiveBriefingPresentation
      }
      riskSummary={
        riskSummaryPresentation
      }
      riskAssessment={
        riskAssessmentPresentation
      }
      insights={
        insightPresentations
      }
      balanceSheetLines={
        balanceSheetPresentations
      }
      portfolio={
        portfolioPresentation
      }
      properties={
        propertyPresentations
      }
      categories={
        categoryPresentations
      }
      transactions={
        recentTransactionPresentations
      }
      statusItems={statusItems}
      activities={activities}
      operations={
        operationsPresentation
      }
    />
  );
}
