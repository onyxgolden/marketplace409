/**
 * budget.mjs — host-enforced per-task budget tracker.
 * Pure module: no I/O. Counts reads/bytes/files/lines/patch bytes/profiles/
 * wall time; any overrun aborts the run (never READY).
 */

import { BUDGETS, REASON } from "./constants.mjs";

export function lowerBudgets(base, overrides) {
  const out = { ...base };
  if (!overrides || typeof overrides !== "object") return out;
  for (const [k, v] of Object.entries(overrides)) {
    if (k in out && typeof v === "number" && v >= 0 && v < out[k]) out[k] = v;
  }
  return out;
}

export class BudgetTracker {
  constructor(budgets = BUDGETS, startedAtMs = Date.now()) {
    this.b = { ...budgets };
    this.startedAtMs = startedAtMs;
    this.reads = 0;
    this.contextBytes = 0;
    this.profilesRun = 0;
    this.failed = null; // { reason, detail }
  }

  chargeRead(byteLength) {
    if (this.failed) return this.failed;
    this.reads += 1;
    this.contextBytes += byteLength;
    if (this.reads > this.b.maxScopedReads) {
      return (this.failed = { reason: REASON.BUDGET_EXCEEDED, detail: `reads>${this.b.maxScopedReads}` });
    }
    if (byteLength > this.b.maxBytesPerFile) {
      return (this.failed = { reason: REASON.BUDGET_EXCEEDED, detail: `file>${this.b.maxBytesPerFile}B` });
    }
    if (this.contextBytes > this.b.maxTotalContextBytes) {
      return (this.failed = { reason: REASON.BUDGET_EXCEEDED, detail: `context>${this.b.maxTotalContextBytes}B` });
    }
    return null;
  }

  chargeProfile() {
    if (this.failed) return this.failed;
    this.profilesRun += 1;
    if (this.profilesRun > this.b.maxProfiles) {
      return (this.failed = { reason: REASON.BUDGET_EXCEEDED, detail: `profiles>${this.b.maxProfiles}` });
    }
    return null;
  }

  checkWall(nowMs = Date.now()) {
    if (this.failed) return this.failed;
    if (nowMs - this.startedAtMs > this.b.totalWallMs) {
      return (this.failed = { reason: REASON.BUDGET_EXCEEDED, detail: `wall>${this.b.totalWallMs}ms` });
    }
    return null;
  }

  checkPatch(bytes, addedRemovedLines, fileCount) {
    if (fileCount > this.b.maxTargetFiles) {
      return { reason: REASON.BUDGET_EXCEEDED, detail: `files>${this.b.maxTargetFiles}` };
    }
    if (addedRemovedLines > this.b.maxAddedRemovedLines) {
      return { reason: REASON.BUDGET_EXCEEDED, detail: `lines>${this.b.maxAddedRemovedLines}` };
    }
    if (bytes > this.b.maxPatchBytes) {
      return { reason: REASON.BUDGET_EXCEEDED, detail: `patch>${this.b.maxPatchBytes}B` };
    }
    return null;
  }

  usage() {
    return {
      reads: this.reads,
      context_bytes: this.contextBytes,
      profiles_run: this.profilesRun,
      wall_ms: Date.now() - this.startedAtMs,
      limits: { ...this.b },
    };
  }
}
