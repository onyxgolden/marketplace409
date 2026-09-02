"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ForgeDashboardApplication,
  ForgeFinancialDashboardApplication,
} from "@/application/financial";
import {
  FinancialPeriodApplication,
} from "@/application/financial/FinancialPeriodApplication";
import FinancialApplicationShell from "@/components/forge/financial/FinancialApplicationShell";
import { isCacheableDashboardLoad, readDashboardCache, writeDashboardCache } from "./dashboardCache.js";
import { money } from "./formatMoney.js";
import { getCurrentMonthProfitKpi } from "./getCurrentMonthProfitKpi.js";

async function loadPropertyOperatingObligations() {
  try {
    const response =
      await fetch(
        "/api/property-operating-obligations",
      );

    const payload =
      await response.json();

    if (
      !response.ok ||
      payload?.success !== true ||
      !Array.isArray(
        payload.obligations,
      )
    ) {
      return [];
    }

    return payload.obligations;
  } catch {
    return [];
  }
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

  const [
    selectedPeriodKey,
    setSelectedPeriodKey,
  ] = useState(null);

  const [
    propertyOperatingObligations,
    setPropertyOperatingObligations,
  ] = useState([]);


  useEffect(() => {
    async function load() {
      // The three loads below combined take 10-15s on a real dataset (see dashboardCache.js for
      // why). A cache hit means this visit is a revisit within the TTL window -- render the last
      // known-good result immediately instead of re-running all three from scratch.
      const cached = readDashboardCache();
      if (cached) {
        setViewModel(cached.viewModel);
        setIntelligenceModel(cached.intelligenceModel);
        setPropertyOperatingObligations(cached.propertyOperatingObligations);
        return;
      }

      const [
        result,
        intelligenceResult,
        obligations,
      ] = await Promise.all([
        ForgeFinancialDashboardApplication.load(),
        ForgeDashboardApplication.loadDashboardIntelligence(),
        loadPropertyOperatingObligations(),
      ]);

      setViewModel(result);
      setIntelligenceModel(intelligenceResult);
      setPropertyOperatingObligations(
        obligations,
      );

      if (isCacheableDashboardLoad({ viewModel: result, intelligenceModel: intelligenceResult })) {
        writeDashboardCache({ viewModel: result, intelligenceModel: intelligenceResult, propertyOperatingObligations: obligations });
      }
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
    allScopeTransactions,
    accounts,
    statusItems,
    activities,
  } = viewModel;

  const periodModel =
    FinancialPeriodApplication
      .buildModel({
        transactions,
        obligations:
          propertyOperatingObligations,
        requestedPeriodKey:
          selectedPeriodKey,
      });

  const {
    portfolio:
      periodPortfolio,
    properties:
      periodProperties,
    categories:
      periodCategories,
    transactions:
      periodTransactions,
  } = periodModel.workspace;

  const recentTransactions = [
    ...periodTransactions,
  ]
    .reverse()
    .slice(0, 8);

  const currentMonthProfitKpi = useMemo(
    () => getCurrentMonthProfitKpi(allScopeTransactions, { scope: "business" }),
    [allScopeTransactions],
  );

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
      value: money(currentMonthProfitKpi.profitDollars),
      detail:
        `Revenue ${money(currentMonthProfitKpi.revenueDollars)} · ` +
        `Expenses ${money(currentMonthProfitKpi.expensesDollars)}`,
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

  const portfolioPresentation = periodPortfolio
    ? {
        metrics: [
          {
            label: "Imported Income",
            value: portfolioMoney(periodPortfolio.income),
          },
          {
            label: "Imported Expenses",
            value: portfolioMoney(periodPortfolio.expenses),
          },
          {
            label: "Accrued Property Costs",
            value: portfolioMoney(
              periodPortfolio
                .accruedOperatingExpenses,
            ),
          },
          {
            label: "NOI",
            value: portfolioMoney(periodPortfolio.noi),
          },
          {
            label: "Cash Flow",
            value: portfolioMoney(periodPortfolio.cashFlow),
          },
          {
            label: "Transactions",
            value: Number(
              periodPortfolio.transactionCount || 0,
            ).toLocaleString(),
          },
        ],
      }
    : null;

  const propertyPresentations = periodProperties.map(
    (property) => ({
      propertyId: property.propertyId,
      propertyName: displayPropertyName(
        property.propertyId,
      ),
      transactionCount: property.transactionCount,
      income: portfolioMoney(property.income),
      expenses: portfolioMoney(property.expenses),
      accruedOperatingExpenses:
        portfolioMoney(
          property
            .accruedOperatingExpenses,
        ),
      noi: portfolioMoney(property.noi),
      noiIsNegative: Number(property.noi) < 0,
      cashFlow: portfolioMoney(property.cashFlow),
      cashFlowIsNegative:
        Number(property.cashFlow) < 0,
    }),
  );

  const categoryPresentations = periodCategories.map(
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
      periodOptions={
        periodModel.options
      }
      selectedPeriodKey={
        periodModel.selectedPeriodKey
      }
      selectedPeriodLabel={
        periodModel.selectedPeriodLabel
      }
      onPeriodChange={
        setSelectedPeriodKey
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
      allScopeTransactions={
        allScopeTransactions
      }
      accounts={accounts}
      statusItems={statusItems}
      activities={activities}
      operations={
        operationsPresentation
      }
    />
  );
}
