export class FinancialForecastService {
  forecast(kpis = {}) {
    const revenue = Number(kpis.revenue || 0);
    const expenses = Number(kpis.expenses || 0);

    return Object.freeze({
      nextPeriodRevenueBaseline: revenue,
      nextPeriodExpenseBaseline: expenses,
      nextPeriodProfitBaseline: revenue - expenses,
      method: "current-period-baseline",
    });
  }
}

Object.freeze(FinancialForecastService);
