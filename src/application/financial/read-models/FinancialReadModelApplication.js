export class FinancialReadModelApplication {
  constructor({ reportingApplication }) {
    if (!reportingApplication) {
      throw new Error(
        "FinancialReadModelApplication requires a reporting application.",
      );
    }

    this.reportingApplication = reportingApplication;
  }

  buildBusinessDashboard() {
    const { reports, dashboard } =
      this.reportingApplication.buildDashboardReports();

    return {
      type: "business-dashboard",
      reports,
      dashboard,
    };
  }

  buildInvestorDashboard() {
    const { dashboard } =
      this.reportingApplication.buildDashboardReports();

    return {
      type: "investor-dashboard",
      kpis: dashboard.kpis,
      health: dashboard.health,
      metadata: dashboard.metadata,
    };
  }

  buildKPIModel() {
    const { dashboard } =
      this.reportingApplication.buildDashboardReports();

    return {
      type: "kpi-model",
      kpis: dashboard.kpis,
    };
  }

  buildExecutiveSummary() {
    const { dashboard } =
      this.reportingApplication.buildDashboardReports();

    return {
      type: "executive-summary",
      health: dashboard.health,
      kpis: dashboard.kpis,
    };
  }
}

Object.freeze(FinancialReadModelApplication);
