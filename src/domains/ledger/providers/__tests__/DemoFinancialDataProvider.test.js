import { DemoFinancialDataProvider } from "../DemoFinancialDataProvider.js";

describe("DemoFinancialDataProvider", () => {
  it("returns populated financial engine input data", () => {
    const provider = new DemoFinancialDataProvider();

    const data = provider.getFinancialData();

    expect(data.generalLedger).toBeDefined();
    expect(data.chartOfAccounts).toBeDefined();
    expect(data.generalLedger.entries.length).toBeGreaterThan(0);
    expect(data.chartOfAccounts.accounts.length).toBeGreaterThan(0);
  });
});
