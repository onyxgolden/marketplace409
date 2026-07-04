import { ProductionFinancialDataProvider } from "../ProductionFinancialDataProvider.js";

describe("ProductionFinancialDataProvider", () => {
  it("guards the future production data boundary until implemented", () => {
    const provider = new ProductionFinancialDataProvider();

    expect(() => provider.getFinancialData()).toThrow(
      "ProductionFinancialDataProvider is not implemented yet"
    );
  });
});
