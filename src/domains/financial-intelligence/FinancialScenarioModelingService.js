export class FinancialScenarioModelingService {
  model(kpis = {}) {
    const revenue = Number(kpis.revenue || 0);
    const expenses = Number(kpis.expenses || 0);

    return Object.freeze({
      revenueDownTenPercent: Object.freeze({
        revenue: revenue * 0.9,
        profit: revenue * 0.9 - expenses,
      }),
      expenseUpTenPercent: Object.freeze({
        expenses: expenses * 1.1,
        profit: revenue - expenses * 1.1,
      }),
    });
  }
}

Object.freeze(FinancialScenarioModelingService);
