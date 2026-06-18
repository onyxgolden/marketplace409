export class PropertyCalculations {
  static equity(propertyValue, loanBalance) {
    return propertyValue - loanBalance;
  }

  static loanToValue(loanBalance, propertyValue) {
    if (!propertyValue) return 0;
    return (loanBalance / propertyValue) * 100;
  }

  static monthlyCashFlow(monthlyIncome, monthlyExpenses) {
    return monthlyIncome - monthlyExpenses;
  }

  static annualCashFlow(monthlyIncome, monthlyExpenses) {
    return this.monthlyCashFlow(monthlyIncome, monthlyExpenses) * 12;
  }
}
