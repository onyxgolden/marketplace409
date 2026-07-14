import { RentecProductionImportServiceImpl } from "../rentec-import/rentec-production-import.service";
import { QuickBooksProductionImportServiceImpl } from "../quickbooks-import/quickbooks-production-import.service";

function buildDefaultImporters({ ownerId = null } = {}) {
  return Object.freeze({
    rentec: new RentecProductionImportServiceImpl({ ownerId }),
    quickbooks: new QuickBooksProductionImportServiceImpl({ ownerId }),
  });
}

class FinancialImportServiceImpl {
  constructor({
    ownerId = null,
    financialEventRepository = null,
    importers = buildDefaultImporters({ ownerId }),
  } = {}) {
    this.ownerId = ownerId;
    this.financialEventRepository = financialEventRepository;
    this.importers = importers;

    Object.freeze(this);
  }

  resolveImportService(source) {
    const service = this.importers[source];

    if (!service) {
      throw new Error(`Unsupported financial import source: ${source}`);
    }

    return service;
  }

  importCsv({ source, csv, chartOfAccounts }) {
    return this.resolveImportService(source).importCsv({
      csv,
      chartOfAccounts,
    });
  }

  importRows({ source, rows, chartOfAccounts }) {
    const service = this.resolveImportService(source);

    if (typeof service.importRows !== "function") {
      throw new Error(
        `Financial import source does not support row imports: ${source}`,
      );
    }

    return service.importRows({
      rows,
      chartOfAccounts,
    });
  }
}

export const FinancialImportService = new FinancialImportServiceImpl();

export { FinancialImportServiceImpl, buildDefaultImporters };
