import type { RiskSnapshot } from "./risk-history.service";

export interface RiskSnapshotRepository {
  save(snapshot: RiskSnapshot): void;
  latest(): RiskSnapshot | null;
  previous(): RiskSnapshot | null;
  all(): RiskSnapshot[];
}
