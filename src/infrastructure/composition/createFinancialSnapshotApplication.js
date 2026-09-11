import {
  FinancialReportingApplication,
  FinancialSnapshotApplication,
} from "../../application/index.js";
import {
  FinancialDashboardService,
  FinancialEngine,
  SnapshotHistoryService,
} from "../../domains/ledger/index.js";
import { createFinancialSnapshotRepository } from "./createFinancialSnapshotRepository.js";

// financialData/provider are NEVER implicitly demo-backed here -- same discipline as, and
// forwarded from, createFinancialApplicationSuite.js's own top-level fix. An authenticated
// production caller reaching this via createFinancialApplicationSuite never supplies real
// financial data today (no real provider exists yet -- see
// domains/ledger/providers/ProductionFinancialDataProvider.js), so reportingApplication and
// snapshotApplication resolve to null rather than silently reporting fabricated numbers as though
// they belonged to the authenticated user. DemoFinancialDataProvider remains available for any
// caller (test, Storybook/preview, fixture) that explicitly passes options.provider or
// options.financialData. Do not reintroduce an implicit `options.provider || new
// DemoFinancialDataProvider()` fallback here.
export async function createFinancialSnapshotApplication(options = {}) {
  const financialData =
    options.financialData ||
    (options.provider ? options.provider.getFinancialData() : null);
  const engine =
    options.engine || (financialData ? new FinancialEngine(financialData) : null);
  const dashboardService =
    options.dashboardService || new FinancialDashboardService();
  const repository =
    options.repository || (await createFinancialSnapshotRepository(options));
  const historyService =
    options.historyService || new SnapshotHistoryService(repository);

  // null, not a demo-backed instance, when no real financial data was configured -- callers
  // (e.g. /api/financial/snapshot) must treat a null snapshotApplication as "financial data
  // unavailable," never call into it and risk it being demo data, and never treat null as $0.
  const reportingApplication =
    options.reportingApplication ||
    (engine
      ? new FinancialReportingApplication({
          engine,
          dashboardService,
        })
      : null);

  const snapshotApplication =
    options.snapshotApplication ||
    (reportingApplication
      ? new FinancialSnapshotApplication({
          reportingApplication,
          historyService,
        })
      : null);

  return Object.freeze({
    reportingApplication,
    snapshotApplication,
  });
}
