import { ProductionImportWorkflow } from "../import-pipeline";
import { RentecImportParser } from "./rentec-import.parser";
import { RentecImportService } from "./rentec-import.service";
import { rentecSemanticResolver } from "./rentec-semantic-resolver";

class RentecProductionImportServiceImpl {
  constructor({
    workflow = new ProductionImportWorkflow({
      parser: new RentecImportParser(),
      semanticResolver: rentecSemanticResolver,
      summaryBuilder: (records) => RentecImportService.summarize(records),
      sourceName: "Rentec",
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
}

export const RentecProductionImportService =
  new RentecProductionImportServiceImpl();

export { RentecProductionImportServiceImpl };
