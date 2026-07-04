export class FinancialReportingApplication {
  constructor({ engine, dashboardService }) {
    if (!engine) {
      throw new Error("FinancialReportingApplication requires an engine.");
    }

    if (!dashboardService) {
      throw new Error(
        "FinancialReportingApplication requires a dashboard service.",
      );
    }

    this.engine = engine;
    this.dashboardService = dashboardService;
  }

  buildDashboardReports() {
    const reports = this.engine.buildReports();
    const dashboard = this.dashboardService.buildFromReports(reports);

    return {
      reports,
      dashboard,
    };
  }
}

Object.freeze(FinancialReportingApplication);
