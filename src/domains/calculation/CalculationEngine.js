export class CalculationEngine {
  static percentage(part, total) {
    if (!total) return 0;
    return (part / total) * 100;
  }

  static equity(value, debt) {
    return value - debt;
  }

  static loanToValue(loanAmount, propertyValue) {
    return this.percentage(loanAmount, propertyValue);
  }

  static cashFlow(income, expenses) {
    return income - expenses;
  }

  static netWorth(totalAssets, totalLiabilities) {
    return totalAssets - totalLiabilities;
  }

  static debtToIncome(monthlyDebt, monthlyIncome) {
    return this.percentage(monthlyDebt, monthlyIncome);
  }
}
