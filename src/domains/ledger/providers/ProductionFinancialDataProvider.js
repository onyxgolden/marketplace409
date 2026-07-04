import { FinancialDataProvider } from "./FinancialDataProvider.js";

/**
 * ProductionFinancialDataProvider
 *
 * Future boundary for imported financial data, rental portfolio data,
 * and financial institution connections.
 */
export class ProductionFinancialDataProvider extends FinancialDataProvider {
  getFinancialData() {
    throw new Error("ProductionFinancialDataProvider is not implemented yet");
  }
}

Object.freeze(ProductionFinancialDataProvider);
