function cents(value) {
  return Number(value || 0);
}

// The merged dashboard KPI object mixes units, so each field is formatted by its own unit:
// - Position-sourced KPIs (equity, assets, liabilities, cash, debt) are DOLLARS -- the
//   FinancialPositionReadModelAdapter projects account balances in dollars (see formatMoney.js
//   on the Financial page for the same contract).
// - Event-sourced KPIs (profit, revenue, expenses) are CENTS -- financial events store cents.
// Dividing position dollars by 100 rendered a $4.17M net worth as $41,716 on the Workspace tile.
function moneyFromDollars(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents(value));
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

const defaultHealth = Object.freeze({
  label: "Loading",
  detail: "Financial health is being prepared.",
});

export function buildFinancialTilePresentation({
  kpiModel = null,
  executiveSummary = null,
} = {}) {
  const kpis = kpiModel?.kpis || {};
  const health =
    executiveSummary?.health ||
    defaultHealth;

  // Accounts the aggregates silently exclude for lack of any balance row. Passed through so
  // the tile can disclose the exclusion (the figure covers only accounts with a recorded
  // balance) instead of presenting it as complete household net worth.
  const missingBalances = Object.freeze(
    (kpiModel?.missingBalances ?? []).map((entry) =>
      Object.freeze({
        id: entry.id,
        name: entry.name,
        type: entry.type,
      }),
    ),
  );

  return Object.freeze({
    health: Object.freeze({
      label: health.label,
      detail: health.detail,
    }),
    missingBalances,
    kpis: Object.freeze([
      Object.freeze({
        id: "equity",
        label: "Net Worth / Equity",
        value: moneyFromDollars(kpis.equity),
        detail:
          `Assets ${moneyFromDollars(kpis.assets)} · ` +
          `Liabilities ${moneyFromDollars(kpis.liabilities)}`,
      }),
      Object.freeze({
        id: "cash",
        label: "Cash",
        value: moneyFromDollars(kpis.cash),
        detail:
          `Receivables ${moneyFromDollars(kpis.receivables)}`,
      }),
      Object.freeze({
        id: "profit",
        label: "Monthly Profit",
        value: money(kpis.profit),
        detail:
          `Revenue ${money(kpis.revenue)} · ` +
          `Expenses ${money(kpis.expenses)}`,
      }),
      Object.freeze({
        id: "margin",
        label: "Profit Margin",
        value: percent(kpis.margin),
        detail:
          "Revenue retained after expenses",
      }),
    ]),
  });
}
