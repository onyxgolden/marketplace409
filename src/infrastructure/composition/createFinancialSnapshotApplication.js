import {
  FinancialReportingApplication,
  FinancialSnapshotApplication,
} from "../../application/index.js";
import {
  DemoFinancialDataProvider,
  FinancialDashboardService,
  FinancialEngine,
  SnapshotHistoryService,
} from "../../domains/ledger/index.js";
import { createFinancialSnapshotRepository } from "./createFinancialSnapshotRepository.js";

export async function createFinancialSnapshotApplication(options = {}) {
  const provider = options.provider || new DemoFinancialDataProvider();
  const financialData = provider.getFinancialData();
  const engine = options.engine || new FinancialEngine(financialData);
  const dashboardService =
    options.dashboardService || new FinancialDashboardService();
  const repository =
    options.repository || (await createFinancialSnapshotRepository(options));
  const historyService =
    options.historyService || new SnapshotHistoryService(repository);

  const reportingApplication =
    options.reportingApplication ||
    new FinancialReportingApplication({
      engine,
      dashboardService,
    });

  const snapshotApplication =
    options.snapshotApplication ||
    new FinancialSnapshotApplication({
      reportingApplication,
      historyService,
    });

  return Object.freeze({
    reportingApplication,
    snapshotApplication,
  });
}
