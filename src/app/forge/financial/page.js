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
import { isCacheableDashboardLoad, readLastKnownDashboardCache, writeDashboardCache } from "./dashboardCache.js";
import { money } from "./formatMoney.js";
import MonthComparisonPanel from "./MonthComparisonPanel.jsx";
import AskBooksPanel from "./AskBooksPanel.jsx";
import BrainActionBar from "./BrainActionBar.jsx";
import AnomalyAlertsPanel from "./AnomalyAlertsPanel.jsx";
import CashForecastPanel from "./CashForecastPanel.jsx";
import DebtPayoffPanel from "./DebtPayoffPanel.jsx";
import { getCurrentMonthProfitKpi } from "./getCurrentMonthProfitKpi.js";

// The one legitimate source of the dashboard cache's isolation identity -- see
// /api/financial/workspace-identity and dashboardCache.js. Never trust a client-held or
// client-supplied value for canonicalWorkspaceId; this is a server round trip specifically because
// it must be. Returns nulls (never throws) on any auth/resolution failure, which the caller treats
// as "cache is off the table this load" -- not as a reason to fabricate a fallback identity.
async function loadWorkspaceIdentity() {
  try {
    const response = await fetch("/api/financial/workspace-identity");
    if (!response.ok) return { actingUserId: null, canonicalWorkspaceId: null };
    const payload = await response.json();
    if (!payload?.success || !payload.userId || !payload.effectiveOwnerId) {
      return { actingUserId: null, canonicalWorkspaceId: null };
    }
    return { actingUserId: payload.userId, canonicalWorkspaceId: payload.effectiveOwnerId };
  } catch {
    return { actingUserId: null, canonicalWorkspaceId: null };
  }
}

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

// Shared by the "recent transactions" preview AND the full-history account-activity view (see
// allScopeTransactionPresentations below) -- both need the same display shape
// (categoryLabel/isIncome/pre-formatted amount) that FinancialTransactionsSurface actually
// renders, which raw financial-event objects don't have on their own. financialAccountId is
// preserved (unlike the raw event's other internal fields) specifically so account-activity
// filtering still works after this mapping.
function presentTransaction(transaction) {
  return {
    id: transaction.id,
    description: transaction.description,
    eventDate: transaction.eventDate,
    propertyName: displayPropertyName(transaction.propertyId),
    amount: money(transaction.amount),
    isIncome: transaction.transactionKind === "income",
    categoryLabel: displayCategory(transaction.category),
    sourceSystem: transaction.sourceSystem,
    financialAccountId: transaction.financialAccountId,
  };
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

  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    async function load() {
      // Server-resolved BEFORE any cache read is attempted -- the current session and the
      // canonical workspace it's authorized within must both be confirmed first, and the cache is
      // keyed to that exact pair (see dashboardCache.js). No identity (session expired,
      // unauthenticated, resolution failed) means no cache read or write at all -- fall straight
      // through to a fresh, uncached load, never an unscoped fallback key.
      const { actingUserId, canonicalWorkspaceId } = await loadWorkspaceIdentity();

      // Stale-while-revalidate: render the last known-good result immediately regardless of its
      // age -- last known data beats a blank loading skeleton every time. `isStale` (past the
      // 5-minute TTL) only decides whether a background refresh follows; it never decides whether
      // to render the cached data at all (see readLastKnownDashboardCache in dashboardCache.js).
      const cached = (actingUserId && canonicalWorkspaceId)
        ? await readLastKnownDashboardCache({ actingUserId, canonicalWorkspaceId })
        : null;
      if (cached) {
        setViewModel(cached.payload.viewModel);
        setIntelligenceModel(cached.payload.intelligenceModel);
        setPropertyOperatingObligations(cached.payload.propertyOperatingObligations);
        if (!cached.isStale) return; // still within the TTL window -- fresh enough, skip the refetch.
        setIsRefreshing(true);
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
      setIsRefreshing(false);

      if (
        actingUserId && canonicalWorkspaceId
        && isCacheableDashboardLoad({ viewModel: result, intelligenceModel: intelligenceResult })
      ) {
        writeDashboardCache(
          { viewModel: result, intelligenceModel: intelligenceResult, propertyOperatingObligations: obligations },
          { actingUserId, canonicalWorkspaceId },
        );
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

  // The screen's one number: "How much cash do I have right now?" Cash is
  // the dashboard's liquid position KPI, already fetched with the page load --
  // no new query. The 90-day cash forecast below stays the drill-down for the
  // forward-looking question.
  const cashHeadline = {
    value: money(kpis.cash),
    label: "Cash on hand",
    caption: "Liquid cash across your accounts.",
    ready: loadState === "ready",
  };

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
            value: money(periodPortfolio.income),
          },
          {
            label: "Imported Expenses",
            value: money(periodPortfolio.expenses),
          },
          {
            label: "Accrued Property Costs",
            value: money(
              periodPortfolio
                .accruedOperatingExpenses,
            ),
          },
          {
            label: "NOI",
            value: money(periodPortfolio.noi),
          },
          {
            label: "Cash Flow",
            value: money(periodPortfolio.cashFlow),
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
      income: money(property.income),
      expenses: money(property.expenses),
      accruedOperatingExpenses:
        money(
          property
            .accruedOperatingExpenses,
        ),
      noi: money(property.noi),
      noiIsNegative: Number(property.noi) < 0,
      cashFlow: money(property.cashFlow),
      cashFlowIsNegative:
        Number(property.cashFlow) < 0,
    }),
  );

  const categoryPresentations = periodCategories.map(
    (category) => ({
      category: category.category,
      label: displayCategory(category.category),
      value: money(category.netAmount),
      isNegative: Number(category.netAmount) < 0,
    }),
  );

  const recentTransactionPresentations =
    recentTransactions.map(presentTransaction);

  // The account-activity feature (clicking a leaf account row) needs every transaction for that
  // account, latest to oldest -- not the 8-item, current-period-only recentTransactions slice
  // above. allScopeTransactions is the full, unscoped history, but in its raw event shape;
  // present it the same way so FinancialTransactionsSurface renders it correctly either way.
  const allScopeTransactionPresentations = useMemo(
    () => allScopeTransactions.map(presentTransaction),
    [allScopeTransactions],
  );

  return (
    <FinancialApplicationShell
      compareMonthsSection={<MonthComparisonPanel />}
      askBooksSection={<AskBooksPanel />}
      brainActionsSection={<BrainActionBar />}
      anomalyAlertsSection={<AnomalyAlertsPanel />}
      cashForecastSection={<CashForecastPanel />}
      debtPayoffSection={<DebtPayoffPanel />}
      activeFunctionId={
        activeFunctionId
      }
      onFunctionChange={
        setActiveFunctionId
      }
      loadState={loadState}
      isRefreshing={isRefreshing}
      error={
        loadState === "error"
          ? error
          : null
      }
      health={health}
      kpis={kpiPresentations}
      headline={cashHeadline}
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
      allScopeTransactionPresentations={
        allScopeTransactionPresentations
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
