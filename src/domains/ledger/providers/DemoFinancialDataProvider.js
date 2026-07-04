import { FinancialDataProvider } from "./FinancialDataProvider.js";
import { createDemoFinancialData } from "../demoFinancialData.js";

/**
 * DemoFinancialDataProvider
 *
 * Supplies stable demo financial data for local development,
 * API wiring, dashboard previews, and smoke tests.
 */
export class DemoFinancialDataProvider extends FinancialDataProvider {
  getFinancialData() {
    return createDemoFinancialData();
  }
}

Object.freeze(DemoFinancialDataProvider);
