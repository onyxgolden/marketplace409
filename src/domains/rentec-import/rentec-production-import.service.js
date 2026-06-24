import { importPipeline } from "../import-pipeline";
import { RentecImportParser } from "./rentec-import.parser";
import { RentecImportService } from "./rentec-import.service";

class RentecProductionImportServiceImpl {
  constructor({
    parser = new RentecImportParser(),
    importService = RentecImportService,
    pipeline = importPipeline,
  } = {}) {
    this.parser = parser;
    this.importService = importService;
    this.pipeline = pipeline;

    Object.freeze(this);
  }

  importCsv({ csv, chartOfAccounts }) {
    if (typeof csv !== "string") {
      throw new Error("Rentec CSV is required");
    }

    if (!chartOfAccounts) {
      throw new Error("ChartOfAccounts is required");
    }

    const records = this.parser.parseCsv(csv);
    const summary = this.importService.summarize(records);
    const reports = this.pipeline.buildReports({
      records,
      chartOfAccounts,
    });

    return {
      records,
      summary,
      reports,
    };
  }
}

export const RentecProductionImportService =
  new RentecProductionImportServiceImpl();

export { RentecProductionImportServiceImpl };
