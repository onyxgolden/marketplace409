import { FinancialSnapshot } from "./FinancialSnapshot.js";

export class SnapshotHistoryService {
  constructor(repository) {
    if (!repository) {
      throw new Error("SnapshotHistoryService requires a repository.");
    }

    this.repository = repository;
  }

  captureDashboardSnapshot({ id, capturedAt, period, dashboard }) {
    const snapshot = FinancialSnapshot.fromDashboard({
      id,
      capturedAt,
      period,
      dashboard,
    });

    return this.repository.save(snapshot);
  }

  listSnapshots() {
    return this.repository.list();
  }

  getLatestSnapshot() {
    return this.repository.findLatest();
  }
}

Object.freeze(SnapshotHistoryService);
