export class FinancialSnapshotApplication {
  constructor({ reportingApplication, historyService }) {
    if (!reportingApplication) {
      throw new Error(
        "FinancialSnapshotApplication requires a reporting application.",
      );
    }

    if (!historyService) {
      throw new Error("FinancialSnapshotApplication requires a history service.");
    }

    this.reportingApplication = reportingApplication;
    this.historyService = historyService;
  }

  async captureDashboardSnapshot(snapshotInput = {}) {
    const { reports, dashboard } =
      this.reportingApplication.buildDashboardReports();

    await this.historyService.captureDashboardSnapshot({
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
}

Object.freeze(FinancialSnapshotApplication);
