function freezeObject(value) {
  return Object.freeze({
    ...value,
  });
}

function buildHealthStatus({ profit, margin, cashFlow }) {
  if (profit < 0 || cashFlow < 0) {
    return freezeObject({
      label: "Critical",
      detail: "Negative profit or cash flow requires immediate review.",
    });
  }

  if (margin < 0.15 || cashFlow === 0) {
    return freezeObject({
      label: "Warning",
      detail: "Profitability or cash flow needs closer monitoring.",
    });
  }

  return freezeObject({
    label: "Healthy",
    detail: "Profit, margin, and cash flow are currently positive.",
  });
}

function buildKPIs(workspace) {
  const portfolio = workspace.portfolio;
  const revenue = Number(portfolio.income || 0);
  const expenses = Number(portfolio.expenses || 0);
  const profit = Number(portfolio.noi || 0);
  const cashFlow = Number(portfolio.cashFlow || 0);
  const margin = revenue ? profit / revenue : 0;

  return freezeObject({
    revenue,
    expenses,
    profit,
    margin,
    cashFlow,
    noi: profit,
    transactionCount: Number(portfolio.transactionCount || 0),

    // Persisted financial events describe activity, not complete
    // balance-sheet state. These fields remain explicitly unavailable
    // rather than being inferred or fabricated.
    cash: null,
    receivables: null,
    debt: null,
    assets: null,
    liabilities: null,
    equity: null,
  });
}

function buildActivityReports(workspace) {
  return freezeObject({
    portfolio: workspace.portfolio,
    properties: workspace.properties,
    categories: workspace.categories,
    transactions: workspace.transactions,
  });
}

export class FinancialWorkspaceReadModelAdapter {
  buildDashboard(workspace) {
    if (!workspace || typeof workspace !== "object") {
      throw new Error(
        "FinancialWorkspaceReadModelAdapter requires a financial workspace.",
      );
    }

    if (!workspace.portfolio) {
      throw new Error(
        "Financial workspace requires portfolio totals.",
      );
    }

    const kpis = buildKPIs(workspace);
    const health = buildHealthStatus({
      profit: kpis.profit,
      margin: kpis.margin,
      cashFlow: kpis.cashFlow,
    });

    return Object.freeze({
      kpis,
      health,
      balanceSheetLines: Object.freeze([]),
      metadata: freezeObject({
        provider: "financial-events",
        snapshotStatus: "repository-backed",
        phase: "16.2",
        balanceSheetStatus: "unavailable-from-event-activity",
      }),
    });
  }

  buildReports(workspace) {
    if (!workspace || typeof workspace !== "object") {
      throw new Error(
        "FinancialWorkspaceReadModelAdapter requires a financial workspace.",
      );
    }

    return buildActivityReports(workspace);
  }
}

export const financialWorkspaceReadModelAdapter =
  new FinancialWorkspaceReadModelAdapter();

Object.freeze(FinancialWorkspaceReadModelAdapter);
