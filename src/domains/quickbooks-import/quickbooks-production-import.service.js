import { ProductionImportWorkflow } from "../import-pipeline";
import { QuickBooksImportParser } from "./quickbooks-import.parser";
import { quickBooksSemanticResolver } from "./quickbooks-semantic-resolver";

class QuickBooksProductionImportServiceImpl {
  constructor({
    workflow = new ProductionImportWorkflow({
      parser: new QuickBooksImportParser(),
      semanticResolver: quickBooksSemanticResolver,
      sourceName: "QuickBooks",
    }),
  } = {}) {
    this.workflow = workflow;

    Object.freeze(this);
  }

  importCsv({ csv, chartOfAccounts }) {
    return this.workflow.importCsv({
      csv,
      chartOfAccounts,
    });
  }

  importRows({ rows, chartOfAccounts }) {
    return this.workflow.importRows({
      rows,
      chartOfAccounts,
    });
  }
}

export const QuickBooksProductionImportService =
  new QuickBooksProductionImportServiceImpl();

export { QuickBooksProductionImportServiceImpl };
