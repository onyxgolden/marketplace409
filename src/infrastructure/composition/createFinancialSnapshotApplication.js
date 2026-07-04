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

  function buildDashboardReports() {
    const reports = engine.buildReports();
    const dashboard = dashboardService.buildFromReports(reports);

    return {
      reports,
      dashboard,
    };
  }

  async function captureDashboardSnapshot(snapshotInput = {}) {
    const { reports, dashboard } = buildDashboardReports();

    await historyService.captureDashboardSnapshot({
      id: snapshotInput.id || crypto.randomUUID(),
      capturedAt: snapshotInput.capturedAt || new Date().toISOString(),
      period: snapshotInput.period || {
        start: null,
        end: null,
      },
      dashboard,
    });

    return {
      reports,
      dashboard,
    };
  }

  return Object.freeze({
    buildDashboardReports,
    captureDashboardSnapshot,
  });
}
