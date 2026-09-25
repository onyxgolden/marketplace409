// Financial slice warm-switch contract: the converted financial panels serve cached
// data on first paint with no loading flash, keep last-good data when a refresh fails,
// and only show the ForgeStates skeleton when nothing is cached.
import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { clearSWRCache, fetchWithDedupe } from "../../../hooks/swrCache";
import FinancialAccountBalancesPanel from "./FinancialAccountBalancesPanel.jsx";
import FinancialAssetsPanel from "./FinancialAssetsPanel.jsx";
import InvestmentAccountsPanel from "./InvestmentAccountsPanel.jsx";
import AnomalyAlertsPanel from "../../../app/forge/financial/AnomalyAlertsPanel.jsx";
import CashForecastPanel from "../../../app/forge/financial/CashForecastPanel.jsx";
import DebtPayoffPanel from "../../../app/forge/financial/DebtPayoffPanel.jsx";
import MonthComparisonPanel from "../../../app/forge/financial/MonthComparisonPanel.jsx";

function lastThreeCalendarMonths() {
  const now = new Date();
  return [2, 1, 0].map((ago) => {
    const date = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - ago, 1),
    );
    return date.toISOString().slice(0, 7);
  });
}

const balancesPayload = {
  accounts: [{
    id: "acc_1", name: "Business Checking", type: "depository",
    latestBalance: { currentBalanceCents: 250000, asOf: "2026-09-24", editable: true, provider: "manual" },
  }],
  assets: [],
  investmentAccounts: [],
};

const assetsPayload = {
  assets: [{
    id: "asset_1", name: "F-150", assetClass: "vehicle", ownershipScope: "business",
    latestValuation: { amountCents: 2500000, effectiveDate: "2026-09-01", source: "manual" },
    purchaseCostCents: null, purchaseDate: null, linkedPropertyId: null, notes: null,
  }],
  properties: [],
};

const investmentPayload = {
  accounts: [{
    id: "inv_1", name: "Brokerage Main", institutionName: "", accountType: "taxable_brokerage",
    taxTreatment: "taxable", ownershipScope: "business",
    latestValuation: { amountCents: 5000000, effectiveDate: "2026-09-01" }, notes: "",
  }],
};

const anomaliesPayload = [{
  type: "spend-spike", severity: "high",
  title: "Spending spike: Supplies",
  detail: "Supplies ran 3.2x the baseline this month.",
  evidence: { baselineMean: 100, baselineStd: 20, trailing30Days: 320, multiple: 3.2 },
}];

const forecastPayload = {
  warnings: [],
  accounts: [{
    accountId: "acc_1", name: "Operating Checking",
    startingBalance: 10000, minBalance: 8000, minBalanceDate: "2026-10-01",
    dailyBurn: 50, warnings: [],
    checkpoints: [{ projectedBalance: 10000 }, { projectedBalance: 9000 }],
  }],
};

const debtPayload = {
  strategies: {
    avalanche: {
      totalInterest: 1200.50, converged: true, monthsToDebtFree: 24,
      order: [{ id: "d1", name: "Home Equity", payoffMonth: 24, totalInterest: 1200.50 }],
    },
    snowball: {
      totalInterest: 1500.00, converged: true, monthsToDebtFree: 26,
      order: [{ id: "d1", name: "Home Equity", payoffMonth: 26, totalInterest: 1500.00 }],
    },
    minimums: {
      totalInterest: 2000.00, converged: true, monthsToDebtFree: 60,
      order: [{ id: "d1", name: "Home Equity", payoffMonth: 60, totalInterest: 2000.00 }],
    },
  },
  interestSavedVsMinimums: { avalanche: 799.50, snowball: 500.00, minimums: 0 },
  eligible: [{
    id: "d1", name: "Home Equity", balance: 50000,
    apr: 7.5, minimumPayment: 1413.83, taxDeductible: false, effectiveApr: 7.5,
  }],
  needsTerms: [],
  topMove: null,
  marginalTaxRate: 0,
  suggestionsEnabled: true,
};

const comparisonPayload = [{
  period: { key: "2026-09", label: "Sep 2026" },
  lines: [{ accountId: "a_rev", name: "Rent income", type: "revenue", amount: 5000 }],
  totals: { revenue: 5000, expenses: 0, netIncome: 5000 },
}];

beforeEach(() => { clearSWRCache(); });

describe("financial slice warm-switch behavior", () => {
  it("renders the cached account tree instantly with no loading flash", async () => {
    await fetchWithDedupe("financial:account-balances", () => Promise.resolve(balancesPayload));
    const html = renderToStaticMarkup(<FinancialAccountBalancesPanel />);
    expect(html).toContain("Net Worth");
    expect(html).toContain("$2,500.00");
    expect(html).not.toContain("Loading accounts");
  });

  it("shows the account skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(<FinancialAccountBalancesPanel />);
    expect(html).toContain("Loading accounts…");
  });

  it("keeps the last good balances visible when a refresh fails", async () => {
    await fetchWithDedupe("financial:account-balances", () => Promise.resolve(balancesPayload));
    await fetchWithDedupe("financial:account-balances", () => Promise.reject(new Error("refresh failed"))).catch(() => {});
    const html = renderToStaticMarkup(<FinancialAccountBalancesPanel />);
    expect(html).toContain("Net Worth");
    expect(html).not.toContain("Loading accounts");
  });

  it("renders the cached asset registry instantly with no loading flash", async () => {
    await fetchWithDedupe("financial:assets", () => Promise.resolve(assetsPayload));
    const html = renderToStaticMarkup(<FinancialAssetsPanel />);
    expect(html).toContain("F-150");
    expect(html).toContain("$25,000.00");
    expect(html).not.toContain("Loading assets");
  });

  it("shows the asset skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(<FinancialAssetsPanel />);
    expect(html).toContain("Loading assets…");
  });

  it("renders the cached investment registry instantly with no loading flash", async () => {
    await fetchWithDedupe("financial:investment-accounts", () => Promise.resolve(investmentPayload));
    const html = renderToStaticMarkup(<InvestmentAccountsPanel />);
    expect(html).toContain("Brokerage Main");
    expect(html).toContain("$50,000.00");
    expect(html).not.toContain("Loading investment accounts");
  });

  it("shows the investment skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(<InvestmentAccountsPanel />);
    expect(html).toContain("Loading investment accounts…");
  });

  it("renders the cached anomaly alerts instantly with no loading flash", async () => {
    await fetchWithDedupe("financial:anomalies", () => Promise.resolve(anomaliesPayload));
    const html = renderToStaticMarkup(<AnomalyAlertsPanel />);
    expect(html).toContain("Spending spike: Supplies");
    expect(html).not.toContain("Scanning the books");
  });

  it("shows the anomaly skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(<AnomalyAlertsPanel />);
    expect(html).toContain("Scanning the books…");
  });

  it("keeps the last good anomaly scan visible when a refresh fails", async () => {
    await fetchWithDedupe("financial:anomalies", () => Promise.resolve(anomaliesPayload));
    await fetchWithDedupe("financial:anomalies", () => Promise.reject(new Error("refresh failed"))).catch(() => {});
    const html = renderToStaticMarkup(<AnomalyAlertsPanel />);
    expect(html).toContain("Spending spike: Supplies");
    expect(html).not.toContain("Scanning the books");
  });

  it("renders the cached cash forecast instantly with no loading flash", async () => {
    await fetchWithDedupe("financial:forecast:90", () => Promise.resolve(forecastPayload));
    const html = renderToStaticMarkup(<CashForecastPanel />);
    expect(html).toContain("Operating Checking");
    expect(html).not.toContain("Projecting balances");
  });

  it("shows the forecast skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(<CashForecastPanel />);
    expect(html).toContain("Projecting balances…");
  });

  it("renders the cached debt-payoff comparison instantly with no loading flash", async () => {
    await fetchWithDedupe("financial:debt-payoff:500:0", () => Promise.resolve(debtPayload));
    const html = renderToStaticMarkup(<DebtPayoffPanel />);
    expect(html).toContain("Home Equity");
    expect(html).toContain("$1,200.50");
    expect(html).not.toContain("Building the payoff comparison");
  });

  it("shows the debt-payoff skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(<DebtPayoffPanel />);
    expect(html).toContain("Building the payoff comparison…");
  });

  it("renders the cached month comparison instantly with no loading flash", async () => {
    const key = `financial:comparison:${lastThreeCalendarMonths().join(",")}`;
    await fetchWithDedupe(key, () => Promise.resolve(comparisonPayload));
    const html = renderToStaticMarkup(<MonthComparisonPanel />);
    expect(html).toContain("Rent income");
    expect(html).toContain("Sep 2026");
    expect(html).not.toContain("Loading the comparison");
  });

  it("shows the month-comparison skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(<MonthComparisonPanel />);
    expect(html).toContain("Loading the comparison…");
  });
});
