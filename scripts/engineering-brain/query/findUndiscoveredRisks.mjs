/**
 * findUndiscoveredRisks.mjs — FORGE Engineering Brain: undiscovered-error detection.
 *
 * Read-only. Surfaces risk signals nobody has asked about yet, so the Brain can point at
 * likely-undiscovered problems instead of waiting for a failure report:
 *
 *   1. Fix hotspots — files that needed genuine fixes repeatedly. A file fixed five times
 *      is where the sixth bug most likely lives.
 *   2. Untested sources — application source files (including API routes) with exported
 *      symbols but no naming-convention-paired test file. No test pins the behavior, so a
 *      regression can land silently.
 *   3. Latent conflicts — the full-manifest contradiction sweep: places where a document
 *      or recorded decision disagrees with the current code and nobody queried about it.
 *
 * Pure, deterministic, no model calls. The same manifest + bug catalog always produce
 * byte-identical output.
 *
 * Known limitation: latent-conflict detection groups by exact symbol/section name, so it only
 * fires when a document section shares a name with a code symbol. Prose that describes code
 * without naming it exactly will not match — a future slice can add fuzzy subject matching.
 */

import { detectConflicts } from "./detectConflicts.mjs";

// Only genuine product fixes count toward hotspot heat. Test and doc fixes are churn, not risk.
const HOTSPOT_CLASSES = new Set(["fix", "revert"]);

const SOURCE_FILE_TYPES = new Set(["application_source_file", "api_route_file"]);
const SOURCE_SYMBOL_TYPES = new Set(["application_source_symbol", "api_route_symbol"]);

/**
 * Rank files by how many genuine fixes touched them.
 * Returns [{ path, fixCount, firstFix, latestFix, recentSubjects }] sorted by fixCount
 * (desc), then latestFix (desc). `recentSubjects` holds up to 3 latest fix subjects.
 */
export function findFixHotspots(bugRecords, { topN = 20 } = {}) {
  const byPath = new Map();
  for (const record of bugRecords || []) {
    if (!HOTSPOT_CLASSES.has(record.class)) continue;
    for (const file of record.files || []) {
      if (!byPath.has(file)) {
        byPath.set(file, { path: file, fixCount: 0, firstFix: record.date, latestFix: record.date, recentSubjects: [] });
      }
      const entry = byPath.get(file);
      entry.fixCount += 1;
      if (record.date < entry.firstFix) entry.firstFix = record.date;
      if (record.date > entry.latestFix) entry.latestFix = record.date;
      entry.recentSubjects.push({ date: record.date, subject: record.subject });
    }
  }
  const hotspots = Array.from(byPath.values()).map((entry) => ({
    ...entry,
    recentSubjects: entry.recentSubjects
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, 3)
      .map((s) => s.subject),
  }));
  hotspots.sort((a, b) => b.fixCount - a.fixCount || (a.latestFix < b.latestFix ? 1 : -1));
  return hotspots.slice(0, Math.max(0, topN));
}

/**
 * Find source files with exported symbols but no naming-convention-paired test file.
 * Returns [{ path, sourceType, symbolCount }] sorted by symbolCount (desc), then path.
 */
export function findUntestedSources(manifestRecords) {
  const records = manifestRecords || [];
  const testedPaths = new Set();
  const sourceFiles = new Map();
  const symbolCounts = new Map();

  for (const record of records) {
    if (record.source_type === "test_file") {
      for (const associated of record.details?.associatedSourcePaths || []) {
        testedPaths.add(associated);
      }
    } else if (SOURCE_FILE_TYPES.has(record.source_type)) {
      if (!sourceFiles.has(record.source_path)) {
        sourceFiles.set(record.source_path, record.source_type);
      }
    } else if (SOURCE_SYMBOL_TYPES.has(record.source_type)) {
      symbolCounts.set(record.source_path, (symbolCounts.get(record.source_path) || 0) + 1);
    }
  }

  const untested = [];
  for (const [path, sourceType] of sourceFiles) {
    if (!testedPaths.has(path)) {
      untested.push({ path, sourceType, symbolCount: symbolCounts.get(path) || 0 });
    }
  }
  untested.sort((a, b) => b.symbolCount - a.symbolCount || a.path.localeCompare(b.path));
  return untested;
}

/**
 * Run the contradiction detector over the whole manifest, not just query hits.
 * Returns the raw conflict list (subject, winner, outranked) sorted by subject.
 */
export function findLatentConflicts(manifestRecords) {
  return detectConflicts((manifestRecords || []).map((record) => ({ record })));
}

/** Assemble the full risk report from a manifest's records and bug-catalog records. */
export function findUndiscoveredRisks({ manifestRecords, bugRecords, topHotspots = 20 } = {}) {
  const records = manifestRecords || [];
  const hotspots = findFixHotspots(bugRecords, { topN: topHotspots });
  const untestedSources = findUntestedSources(records);
  const latentConflicts = findLatentConflicts(records);
  return {
    hotspots,
    untestedSources,
    latentConflicts,
    counts: {
      hotspotFiles: hotspots.length,
      untestedSources: untestedSources.length,
      latentConflicts: latentConflicts.length,
      manifestRecords: records.length,
      bugRecords: (bugRecords || []).length,
    },
  };
}
