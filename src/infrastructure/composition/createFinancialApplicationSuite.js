import { createFinancialSnapshotApplication } from "./createFinancialSnapshotApplication.js";
import { createFinancialSnapshotRepository } from "./createFinancialSnapshotRepository.js";

import { FinancialReportingApplication } from "../../application/financial/FinancialReportingApplication.js";

import { FinancialEngine } from "../../domains/ledger/engines/FinancialEngine.js";
import { FinancialDashboardService } from "../../domains/ledger/dashboard/FinancialDashboardService.js";

export function createFinancialApplicationSuite(deps = {}) {
  const snapshotRepository =
    deps.snapshotRepository || createFinancialSnapshotRepository();

  const snapshotApplication =
    deps.snapshotApplication ||
    createFinancialSnapshotApplication({
      snapshotRepository,
    });

  const engine =
    deps.engine ||
    new FinancialEngine({
      generalLedger: deps.generalLedger,
      chartOfAccounts: deps.chartOfAccounts,
    });

  const dashboardService =
    deps.dashboardService || new FinancialDashboardService();

  const reportingApplication =
    deps.reportingApplication ||
    new FinancialReportingApplication({
      engine,
      dashboardService,
    });

  return {
    snapshotApplication,
    reportingApplication,
    snapshotRepository,
    engine,
    dashboardService,
  };
}
