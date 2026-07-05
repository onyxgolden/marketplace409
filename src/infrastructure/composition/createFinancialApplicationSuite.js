import { createFinancialSnapshotApplication } from "./createFinancialSnapshotApplication.js";
import { createFinancialSnapshotRepository } from "./createFinancialSnapshotRepository.js";

import {
  FinancialExplainabilityApplication,
  FinancialReportingApplication,
} from "../../application/financial";

import { FinancialEngine } from "../../domains/ledger/engines/FinancialEngine.js";
import { FinancialDashboardService } from "../../domains/ledger/dashboard/FinancialDashboardService.js";
import { traceExplorerService } from "../../domains/ledger/trace/TraceExplorerService.js";
import { traceQueryService } from "../../domains/ledger/trace/TraceQueryService.js";

export async function createFinancialApplicationSuite(deps = {}) {
  const snapshotRepository =
    deps.snapshotRepository || createFinancialSnapshotRepository();

  const snapshotApplication =
    deps.snapshotApplication ||
    await createFinancialSnapshotApplication({
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

  const explainabilityApplication =
    deps.explainabilityApplication ||
    new FinancialExplainabilityApplication({
      traceExplorerService:
        deps.traceExplorerService || traceExplorerService,
      traceQueryService:
        deps.traceQueryService || traceQueryService,
    });

  return {
    snapshotApplication,
    reportingApplication,
    explainabilityApplication,
    snapshotRepository,
    engine,
    dashboardService,
  };
}
