export class HistoricalDashboardQuery {
  constructor(repository) {
    if (!repository) {
      throw new Error("HistoricalDashboardQuery requires a repository.");
    }

    this.repository = repository;
  }

  getKpiSeries(kpiName) {
    return Object.freeze(
      this.repository.list().map((snapshot) =>
        Object.freeze({
          snapshotId: snapshot.id,
          capturedAt: snapshot.capturedAt,
          period: snapshot.period,
          value: Number(snapshot.kpis?.[kpiName] || 0),
        }),
      ),
    );
  }

  getHealthTimeline() {
    return Object.freeze(
      this.repository.list().map((snapshot) =>
        Object.freeze({
          snapshotId: snapshot.id,
          capturedAt: snapshot.capturedAt,
          period: snapshot.period,
          label: snapshot.health?.label || "Unknown",
          detail: snapshot.health?.detail || "",
        }),
      ),
    );
  }
}

Object.freeze(HistoricalDashboardQuery);
