// FORGE Brain conversation harness — nightly consolidation ("sleep").
//
// Powers (contract §4 / scope Q2–Q3), enforced in code, not just in prose:
//   MAY: promote uncontested facts, merge duplicates, flag inferred decay,
//        gist + archive old episodes.
//   MUST NOT: silently change standing rules, resolve conflicts, grant
//        permissions, or close obligations without verified completion
//        evidence. So: conflicts become flags and nothing is touched;
//        owner_stated salience is never changed; flags are never
//        auto-resolved; rows are never deleted.
//
// No model, no free-text extraction: candidate facts are structured
// { key, text } attached to episodes at append time. The gist is
// extractive (first sentences), deterministic, and capped at 280 chars.
//
// Archival safety catch: archival sets the gist, the status, and the
// reserved storage path, but RETAINS the raw content until a Storage
// upload step is configured at activation. Deleting raw content before
// the upload path exists would destroy data; the upload is activation
// wiring, not claimed here.

import {
  CONSOLIDATION_CANDIDATE_LIMIT,
  CONSOLIDATION_NEW_FRACTION,
  DEFAULT_ARCHIVE_WINDOW_DAYS,
  DEFAULT_INFERRED_DECAY_DAYS,
} from "./config.js";

const MS_PER_DAY = 86400000;
const MAX_GIST_CHARS = 280;

export function extractiveGist(content) {
  const text = String(content ?? "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  const sentences = text.split(/(?<=[.!?])\s+/);
  let gist = "";
  for (const sentence of sentences) {
    const candidate = gist ? `${gist} ${sentence}` : sentence;
    if (candidate.length > MAX_GIST_CHARS) break;
    gist = candidate;
  }
  if (!gist) return `${text.slice(0, MAX_GIST_CHARS - 3).trim()}...`;
  return gist;
}

export function normalizeFactText(text) {
  return String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.]+$/, "");
}

export function selectReplayCandidates(
  episodes,
  { limit = CONSOLIDATION_CANDIDATE_LIMIT, newFraction = CONSOLIDATION_NEW_FRACTION } = {},
) {
  const sorted = [...(episodes ?? [])].sort(
    (a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
  );
  const newestCount = Math.ceil(limit * newFraction);
  const picked = [];
  const seen = new Set();
  for (const episode of sorted.slice(0, newestCount)) {
    if (!seen.has(episode.id)) {
      seen.add(episode.id);
      picked.push(episode);
    }
  }
  for (const episode of [...sorted].reverse()) {
    if (picked.length >= limit) break;
    if (!seen.has(episode.id)) {
      seen.add(episode.id);
      picked.push(episode);
    }
  }
  return picked.slice(0, limit);
}

function ageDays(isoDate, nowMs) {
  const parsed = Date.parse(isoDate ?? "");
  if (Number.isNaN(parsed)) return 0;
  return Math.max(0, (nowMs - parsed) / MS_PER_DAY);
}

export async function runConsolidation(
  store,
  ownerId,
  {
    now = new Date(),
    archiveWindowDays = DEFAULT_ARCHIVE_WINDOW_DAYS,
    decayDays = DEFAULT_INFERRED_DECAY_DAYS,
    limit = CONSOLIDATION_CANDIDATE_LIMIT,
  } = {},
) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const runAt = new Date(nowMs).toISOString();
  const episodes = await store.listEpisodes(ownerId);
  const semantic = await store.listSemanticEntries(ownerId);
  const existingFlags = await store.listFlags(ownerId, { resolved: false });
  const hasOpenFlag = (kind, subjectId) =>
    existingFlags.some((f) => f.kind === kind && f.subjectId === subjectId);

  let promoted = 0;
  let merged = 0;
  let conflictsFlagged = 0;
  let decayFlagged = 0;
  let archived = 0;

  // -- Promote / merge / flag candidate facts ------------------------------
  const candidates = selectReplayCandidates(episodes, { limit });
  // Corroboration: the same fact text appears in at least two episodes.
  const factEpisodeCount = new Map();
  for (const episode of episodes) {
    const seenKeys = new Set();
    for (const fact of episode.candidateFacts ?? []) {
      if (!fact?.key || !fact?.text) continue;
      const mapKey = `${fact.key}::${normalizeFactText(fact.text)}`;
      if (seenKeys.has(mapKey)) continue;
      seenKeys.add(mapKey);
      factEpisodeCount.set(mapKey, (factEpisodeCount.get(mapKey) ?? 0) + 1);
    }
  }

  // Track entries created during this run so later facts see them.
  const known = [...semantic];
  for (const episode of candidates) {
    const tags = new Set((episode.tags ?? []).map((t) => String(t).toLowerCase()));
    for (const fact of episode.candidateFacts ?? []) {
      if (!fact?.key || !fact?.text) continue;
      const normalized = normalizeFactText(fact.text);
      const sameKey = known.filter((e) => e.factKey === fact.key);
      const matching = sameKey.find((e) => normalizeFactText(e.content) === normalized);
      if (matching) {
        // Merge: extend provenance only when it actually changes, so a
        // repeat run counts zero merges (idempotent).
        const source = "chat episode";
        if (!(matching.provenanceSource ?? "").includes(source)) {
          const nextSource = matching.provenanceSource
            ? `${matching.provenanceSource}; ${source}`
            : source;
          await store.updateSemanticEntry(ownerId, matching.id, {
            provenanceSource: nextSource,
          });
          matching.provenanceSource = nextSource;
          merged += 1;
        }
        continue;
      }
      if (sameKey.length > 0) {
        // Conflict: flag it, touch nothing. Never silently resolve.
        const subjectId = sameKey[0].id;
        if (!hasOpenFlag("conflict", subjectId)) {
          await store.addFlag(ownerId, {
            kind: "conflict",
            subjectType: "semantic",
            subjectId,
            detail:
              "Conflicting notes share the same topic; neither was changed. Owner review needed.",
          });
          existingFlags.push({ kind: "conflict", subjectId });
          conflictsFlagged += 1;
        }
        continue;
      }
      const corroborated =
        tags.has("owner_stated") ||
        (factEpisodeCount.get(`${fact.key}::${normalized}`) ?? 0) >= 2;
      const created = await store.createSemanticEntry(ownerId, {
        content: String(fact.text).trim(),
        factKey: fact.key,
        salience: corroborated ? "verified" : "inferred",
        provenanceSource: "chat episode",
        provenanceAt: episode.createdAt ?? runAt,
      });
      known.push(created);
      promoted += 1;
    }
  }

  // -- Inferred decay -------------------------------------------------------
  const freshSemantic = await store.listSemanticEntries(ownerId);
  for (const entry of freshSemantic) {
    if (entry.salience !== "inferred" || entry.decayFlagged) continue;
    const age = ageDays(entry.provenanceAt ?? entry.createdAt, nowMs);
    if (age <= decayDays) continue;
    const corroborated =
      freshSemantic.some((other) => other.id !== entry.id && other.factKey && other.factKey === entry.factKey) ||
      (entry.factKey
        ? episodes.filter((ep) =>
            (ep.candidateFacts ?? []).some(
              (f) => f.key === entry.factKey && normalizeFactText(f.text) === normalizeFactText(entry.content),
            ),
          ).length >= 2
        : false);
    if (corroborated) continue;
    await store.updateSemanticEntry(ownerId, entry.id, {
      decayFlagged: true,
      decayFlaggedAt: runAt,
    });
    if (!hasOpenFlag("inferred_decay", entry.id)) {
      await store.addFlag(ownerId, {
        kind: "inferred_decay",
        subjectType: "semantic",
        subjectId: entry.id,
        detail:
          "An unconfirmed note is older than the decay window and has no corroboration. Owner review needed.",
      });
      existingFlags.push({ kind: "inferred_decay", subjectId: entry.id });
    }
    decayFlagged += 1;
  }

  // -- Archive old episodes (gist + reserved path, raw retained) ------------
  for (const episode of episodes) {
    if (episode.status !== "active") continue;
    if (ageDays(episode.createdAt, nowMs) <= archiveWindowDays) continue;
    await store.archiveEpisode(ownerId, episode.id, {
      contentGist: extractiveGist(episode.content),
      archiveStoragePath: `brain-archives/${ownerId}/${episode.id}.txt`,
    });
    archived += 1;
  }

  return { promoted, merged, conflictsFlagged, decayFlagged, archived, runAt };
}
