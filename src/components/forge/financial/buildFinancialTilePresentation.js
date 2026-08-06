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

  return Object.freeze({
    health: Object.freeze({
      label: health.label,
      detail: health.detail,
    }),
    kpis: Object.freeze([
      Object.freeze({
        id: "equity",
        label: "Net Worth / Equity",
        value: money(kpis.equity),
        detail:
          `Assets ${money(kpis.assets)} · ` +
          `Liabilities ${money(kpis.liabilities)}`,
      }),
      Object.freeze({
        id: "cash",
        label: "Cash",
        value: money(kpis.cash),
        detail:
          `Receivables ${money(kpis.receivables)}`,
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
