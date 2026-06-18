export class InvestmentCalculations {
  static returnOnInvestment(gain, cost) {
    if (!cost) return 0;
    return (gain / cost) * 100;
  }

  static cashOnCashReturn(annualCashFlow, cashInvested) {
    if (!cashInvested) return 0;
    return (annualCashFlow / cashInvested) * 100;
  }

  static appreciation(currentValue, originalValue) {
    if (!originalValue) return 0;
    return ((currentValue - originalValue) / originalValue) * 100;
  }

  static capRate(netOperatingIncome, propertyValue) {
    if (!propertyValue) return 0;
    return (netOperatingIncome / propertyValue) * 100;
  }
}
