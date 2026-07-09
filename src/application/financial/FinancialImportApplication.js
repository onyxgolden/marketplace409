import { FinancialImportServiceImpl } from "../../domains/financial-import/financial-import.service";
import { buildProductionChartOfAccounts } from "../../domains/production";

function importErrorMessage(caughtError) {
  return caughtError instanceof Error
    ? caughtError.message
    : "Unable to import financial CSV.";
}

export class FinancialImportApplication {
  constructor({
    importServiceFactory = ({ ownerId }) =>
      new FinancialImportServiceImpl({ ownerId }),
    chartOfAccountsFactory = buildProductionChartOfAccounts,
  } = {}) {
    this.importServiceFactory = importServiceFactory;
    this.chartOfAccountsFactory = chartOfAccountsFactory;

    Object.freeze(this);
  }

  async importFile({
    file,
    source,
    ownerId = null,
    resolveOwnerId = async () => ownerId,
  } = {}) {
    if (!file) {
      return Object.freeze({
        fileName: "",
        result: null,
        error: "",
        ownerId,
        hasFile: false,
      });
    }

    try {
      const csv = await file.text();
      const resolvedOwnerId = ownerId ?? await resolveOwnerId();

      const importService = this.importServiceFactory({
        ownerId: resolvedOwnerId,
      });

      const result = importService.importCsv({
        source,
        csv,
        chartOfAccounts: this.chartOfAccountsFactory(),
      });

      return Object.freeze({
        fileName: file.name,
        result,
        error: "",
        ownerId: resolvedOwnerId,
        hasFile: true,
      });
    } catch (caughtError) {
      return Object.freeze({
        fileName: file.name,
        result: null,
        error: importErrorMessage(caughtError),
        ownerId,
        hasFile: true,
      });
    }
  }
}
