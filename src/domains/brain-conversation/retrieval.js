// FORGE Brain conversation harness — per-turn retrieval + injection.
//
// Bounded working set, ranked by relevance x recency with a novelty penalty
// (greedy maximal-marginal-relevance), never by age alone. Pure and
// deterministic: same inputs, same order. No model calls.

export function tokenize(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) overlap += 1;
  }
  return overlap / (a.size + b.size - overlap);
}

export function scoreEntry(entry, queryTokens, nowMs) {
  const contentTokens = new Set(tokenize(entry?.content ?? ""));
  const querySet = new Set(queryTokens);
  const overlap = jaccard(contentTokens, querySet);
  const entryTags = new Set((entry?.tags ?? []).map((t) => String(t).toLowerCase()));
  const tagOverlap = jaccard(entryTags, querySet);
  const relevance = 0.7 * overlap + 0.3 * tagOverlap;
  const parsed = Date.parse(entry?.createdAt ?? entry?.provenanceAt ?? "");
  const ageDays = Number.isNaN(parsed)
    ? 0
    : Math.max(0, (nowMs - parsed) / 86400000);
  const recency = 1 / (1 + ageDays / 30);
  return { relevance, recency, score: 0.6 * relevance + 0.4 * recency };
}

export function selectWorkingSet(entries, { query = "", now = new Date(), limit = 8 } = {}) {
  const queryTokens = tokenize(query);
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const scored = (entries ?? []).map((entry) => ({
    entry,
    ...scoreEntry(entry, queryTokens, nowMs),
  }));
  // Deterministic order before greedy selection: score desc, then newest,
  // then id ascending, so equal scores never depend on input order.
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aTime = Date.parse(a.entry?.createdAt ?? "") || 0;
    const bTime = Date.parse(b.entry?.createdAt ?? "") || 0;
    if (bTime !== aTime) return bTime - aTime;
    return String(a.entry?.id ?? "").localeCompare(String(b.entry?.id ?? ""));
  });
  const picked = [];
  const remaining = [...scored];
  while (picked.length < limit && remaining.length > 0) {
    let bestIndex = 0;
    let bestValue = -Infinity;
    remaining.forEach((candidate, index) => {
      let novelty = 1;
      for (const chosen of picked) {
        const similarity = jaccard(
          new Set(tokenize(candidate.entry?.content ?? "")),
          new Set(tokenize(chosen.entry?.content ?? "")),
        );
        novelty = Math.min(novelty, 1 - similarity);
      }
      const value = candidate.score * (0.7 + 0.3 * novelty);
      if (value > bestValue) {
        bestValue = value;
        bestIndex = index;
      }
    });
    picked.push(remaining.splice(bestIndex, 1)[0]);
  }
  return picked.map((item) => item.entry);
}
