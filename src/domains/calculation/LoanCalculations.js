export class LoanCalculations {
  static monthlyPayment(principal, annualInterestRate, years) {
    if (!principal || !years) return 0;

    const monthlyRate = annualInterestRate / 100 / 12;
    const numberOfPayments = years * 12;

    if (!monthlyRate) return principal / numberOfPayments;

    return (
      (principal * monthlyRate * (1 + monthlyRate) ** numberOfPayments) /
      ((1 + monthlyRate) ** numberOfPayments - 1)
    );
  }

  static totalInterest(principal, annualInterestRate, years) {
    const payment = this.monthlyPayment(principal, annualInterestRate, years);
    return payment * years * 12 - principal;
  }

  static remainingBalance(originalLoanAmount, totalPrincipalPaid) {
    return originalLoanAmount - totalPrincipalPaid;
  }
}
