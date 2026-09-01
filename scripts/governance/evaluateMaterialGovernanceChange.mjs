// Pure comparison logic deciding whether a FORGE governance synchronizer run produced a
// *material* change, or only its own routine snapshot bookkeeping. Every successful run creates a
// brand-new timestamped snapshot file and updates a snapshot-pointer line in
// current-governance-state.json and all 5 FORGE_SYNC_*.md files, even when nothing else changed --
// this module strips ONLY those specific pointer patterns before comparing, so real content
// (objectives, status, roadmap text, warnings, validation results, FORGE:HUMAN:*/FORGE:SYNC:*
// section bodies, anything else) is always compared byte-for-byte and can never be silently
// suppressed as "just bookkeeping". No I/O -- reconcileGovernanceRefresh.mjs does the file reads.

export const GOVERNANCE_POINTER_TRACKED_PATHS = Object.freeze([
  "governance/state/current-governance-state.json",
  "docs/architecture/synchronized/FORGE_SYNC_CONTROL_CENTER.md",
  "docs/architecture/synchronized/FORGE_SYNC_EVALUATION.md",
  "docs/architecture/synchronized/FORGE_SYNC_ROADMAP.md",
  "docs/architecture/synchronized/FORGE_SYNC_SESSION.md",
  "docs/architecture/synchronized/FORGE_SYNC_STATUS.md",
]);

const SNAPSHOT_BOOKKEEPING_PATTERNS = Object.freeze([
  /"latestSnapshot"\s*:\s*".*?"/g,
  /"sourceSnapshot"\s*:\s*".*?"/g,
  /\*\*Evidence Snapshot:\*\*.*$/gm,
]);

export function stripSnapshotBookkeeping(content) {
  let stripped = content;
  for (const pattern of SNAPSHOT_BOOKKEEPING_PATTERNS) {
    stripped = stripped.replace(pattern, "");
  }
  return stripped;
}

export function evaluateMaterialGovernanceChange({ beforeContents, afterContents }) {
  const changedFiles = GOVERNANCE_POINTER_TRACKED_PATHS.filter((path) => {
    const before = stripSnapshotBookkeeping(beforeContents[path] ?? "");
    const after = stripSnapshotBookkeeping(afterContents[path] ?? "");
    return before !== after;
  });

  return Object.freeze({
    materialChangeDetected: changedFiles.length > 0,
    changedFiles: Object.freeze(changedFiles),
  });
}
