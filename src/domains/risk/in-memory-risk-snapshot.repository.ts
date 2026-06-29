import type { RiskSnapshot } from "./risk-history.service";
import type { RiskSnapshotRepository } from "./risk-snapshot.repository";

export class InMemoryRiskSnapshotRepository implements RiskSnapshotRepository {
  private readonly snapshots: RiskSnapshot[] = [];

  save(snapshot: RiskSnapshot): void {
    this.snapshots.push(snapshot);
  }

  latest(): RiskSnapshot | null {
    return this.snapshots.at(-1) ?? null;
  }

  previous(): RiskSnapshot | null {
    return this.snapshots.at(-2) ?? null;
  }

  all(): RiskSnapshot[] {
    return [...this.snapshots];
  }
}
