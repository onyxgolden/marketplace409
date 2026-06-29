import type { RiskSnapshot } from "./risk-history.service";
import type { RiskSnapshotRepository } from "./risk-snapshot.repository";
import type { RiskFinding, RiskSeverity } from "./risk.types";

export type RiskWatchlistStatus = "new" | "recurring" | "resolved";

export type RiskWatchlistRisk = {
  id: string;
  finding: RiskFinding;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  ageInSnapshots: number;
  persistenceScore: number;
  status: RiskWatchlistStatus;
};

export type ExecutiveRiskWatchlistItem = {
  id: string;
  status: RiskWatchlistStatus;
  severity: RiskSeverity;
  score: number;
  persistenceScore: number;
  executiveSummary: string;
  recommendedAction: string;
};

export type RiskWatchlistReport = {
  snapshotCount: number;
  newlyIntroducedRisks: RiskWatchlistRisk[];
  recurringRisks: RiskWatchlistRisk[];
  resolvedRisks: RiskWatchlistRisk[];
  agingRisks: RiskWatchlistRisk[];
  watchlistItems: ExecutiveRiskWatchlistItem[];
};

type RiskOccurrenceRecord = {
  finding: RiskFinding;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  firstSeenIndex: number;
  lastSeenIndex: number;
};

export class RiskWatchlistService {
  private readonly repository: RiskSnapshotRepository;

  constructor({ repository }: { repository: RiskSnapshotRepository }) {
    this.repository = repository;
  }

  analyze(): RiskWatchlistReport {
    const snapshots = this.repository.all();

    if (snapshots.length === 0) {
      return {
        snapshotCount: 0,
        newlyIntroducedRisks: [],
        recurringRisks: [],
        resolvedRisks: [],
        agingRisks: [],
        watchlistItems: [],
      };
    }

    const latestSnapshot = snapshots.at(-1) as RiskSnapshot;
    const previousSnapshot = snapshots.at(-2) ?? null;
    const records = this.buildOccurrenceRecords(snapshots);
    const latestIds = new Set(latestSnapshot.topDrivers.map((finding) => finding.id));
    const previousIds = new Set(
      previousSnapshot?.topDrivers.map((finding) => finding.id) ?? []
    );

    const risks = [...records.entries()].map(([id, record]) =>
      this.toWatchlistRisk({ id, record, snapshotCount: snapshots.length })
    );

    const newlyIntroducedRisks = risks.filter(
      (risk) => latestIds.has(risk.id) && !previousIds.has(risk.id)
    );
    const recurringRisks = risks.filter(
      (risk) => latestIds.has(risk.id) && risk.occurrences > 1
    );
    const resolvedRisks = risks.filter((risk) => !latestIds.has(risk.id));
    const agingRisks = recurringRisks.filter((risk) => risk.ageInSnapshots >= 3);

    return {
      snapshotCount: snapshots.length,
      newlyIntroducedRisks,
      recurringRisks,
      resolvedRisks,
      agingRisks,
      watchlistItems: this.buildExecutiveWatchlistItems([
        ...recurringRisks,
        ...newlyIntroducedRisks,
      ]),
    };
  }

  private buildOccurrenceRecords(
    snapshots: RiskSnapshot[]
  ): Map<string, RiskOccurrenceRecord> {
    const records = new Map<string, RiskOccurrenceRecord>();

    snapshots.forEach((snapshot, snapshotIndex) => {
      snapshot.topDrivers.forEach((finding) => {
        const existing = records.get(finding.id);

        if (!existing) {
          records.set(finding.id, {
            finding,
            occurrences: 1,
            firstSeen: snapshot.timestamp,
            lastSeen: snapshot.timestamp,
            firstSeenIndex: snapshotIndex,
            lastSeenIndex: snapshotIndex,
          });
          return;
        }

        records.set(finding.id, {
          ...existing,
          finding,
          occurrences: existing.occurrences + 1,
          lastSeen: snapshot.timestamp,
          lastSeenIndex: snapshotIndex,
        });
      });
    });

    return records;
  }

  private toWatchlistRisk({
    id,
    record,
    snapshotCount,
  }: {
    id: string;
    record: RiskOccurrenceRecord;
    snapshotCount: number;
  }): RiskWatchlistRisk {
    const status: RiskWatchlistStatus =
      record.lastSeenIndex === snapshotCount - 1
        ? record.occurrences > 1
          ? "recurring"
          : "new"
        : "resolved";

    return {
      id,
      finding: record.finding,
      occurrences: record.occurrences,
      firstSeen: record.firstSeen,
      lastSeen: record.lastSeen,
      ageInSnapshots: record.lastSeenIndex - record.firstSeenIndex + 1,
      persistenceScore: record.occurrences / snapshotCount,
      status,
    };
  }

  private buildExecutiveWatchlistItems(
    risks: RiskWatchlistRisk[]
  ): ExecutiveRiskWatchlistItem[] {
    return [...risks]
      .sort((left, right) => {
        if (right.persistenceScore !== left.persistenceScore) {
          return right.persistenceScore - left.persistenceScore;
        }

        return right.finding.score - left.finding.score;
      })
      .map((risk) => ({
        id: risk.id,
        status: risk.status,
        severity: risk.finding.severity,
        score: risk.finding.score,
        persistenceScore: risk.persistenceScore,
        executiveSummary: `${risk.finding.explanation} Persisted across ${risk.occurrences} of ${risk.ageInSnapshots} snapshots.`,
        recommendedAction: risk.finding.recommendedAction,
      }));
  }
}
