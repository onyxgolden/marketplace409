/**
 * FinancialDataProvider
 *
 * Boundary for supplying FinancialEngine input data.
 *
 * Implementations must return:
 * - generalLedger
 * - chartOfAccounts
 */
export class FinancialDataProvider {
  getFinancialData() {
    throw new Error("FinancialDataProvider.getFinancialData must be implemented");
  }
}

Object.freeze(FinancialDataProvider);
