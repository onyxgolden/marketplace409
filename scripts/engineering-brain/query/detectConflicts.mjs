import { AUTHORITY_LEVELS } from "../authorityLevels.mjs";

const AUTHORITY_RANK_BY_ID = Object.freeze(
  Object.fromEntries(Object.values(AUTHORITY_LEVELS).map((level) => [level.id, level.rank])),
);

// A "subject" is the normalized identity two records are plausibly describing the same thing under:
// same symbol/section name (case-insensitive) if present, else same source path. Two records on the
// same subject but different authority tiers with different content are a conflict -- e.g. a
// lessons-learned doc's prose about how a function behaves versus that function's actual current
// body. The higher-ranked (lower `rank` number) tier wins per requirement 5; this only ever reports
// disagreement, it never silently drops the losing record from results.
function subjectKeyFor(record) {
  const symbol = String(record.symbol_or_section || "").toLowerCase();
  return symbol || record.source_path.toLowerCase();
}

export function detectConflicts(entries) {
  const bySubject = new Map();
  for (const entry of entries) {
    const key = subjectKeyFor(entry.record);
    if (!bySubject.has(key)) bySubject.set(key, []);
    bySubject.get(key).push(entry);
  }

  const conflicts = [];
  for (const [subjectKey, group] of bySubject.entries()) {
    const distinctByAuthorityAndHash = new Map();
    for (const entry of group) {
      const dedupeKey = `${entry.record.authority_level}:${entry.record.content_hash}`;
      if (!distinctByAuthorityAndHash.has(dedupeKey)) distinctByAuthorityAndHash.set(dedupeKey, entry);
    }
    const distinctEntries = Array.from(distinctByAuthorityAndHash.values());
    const distinctAuthorityLevels = new Set(distinctEntries.map((e) => e.record.authority_level));
    const distinctContentHashes = new Set(distinctEntries.map((e) => e.record.content_hash));

    if (distinctAuthorityLevels.size > 1 && distinctContentHashes.size > 1) {
      const sorted = [...distinctEntries].sort((a, b) => (
        AUTHORITY_RANK_BY_ID[a.record.authority_level] - AUTHORITY_RANK_BY_ID[b.record.authority_level]
      ));
      conflicts.push({
        subject: subjectKey,
        winner: {
          source_path: sorted[0].record.source_path,
          authority_level: sorted[0].record.authority_level,
          content_hash: sorted[0].record.content_hash,
        },
        outranked: sorted.slice(1).map((entry) => ({
          source_path: entry.record.source_path,
          authority_level: entry.record.authority_level,
          content_hash: entry.record.content_hash,
        })),
      });
    }
  }

  return conflicts.sort((a, b) => a.subject.localeCompare(b.subject));
}
