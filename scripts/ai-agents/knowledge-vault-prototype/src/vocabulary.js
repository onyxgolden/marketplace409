/**
 * vocabulary.js — bounded natural-language query mapping.
 *
 * A natural-language query maps through the fixture vocabulary to a
 * query_key: each entry carries a bounded phrase list. Substring matching
 * on the lowercased query; zero candidates -> unsupported, more than one
 * distinct query_key -> ambiguous. Nothing is guessed: unmapped or
 * ambiguous text never produces claims. Pure Node 24 ESM, zero deps.
 */

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "is", "are",
  "what", "whats", "what's", "how", "do", "does", "did", "can", "could",
  "me", "my", "you", "your", "it", "its", "this", "that", "with", "by",
  "at", "from", "as", "be", "was", "were", "tell", "please", "about",
]);

/**
 * Map a query to a query_key via the vocabulary.
 * Returns {status:"ok", query_key, matchedPhrases} |
 *         {status:"unsupported"} |
 *         {status:"ambiguous", candidates:[query_key...]}.
 */
export function mapQuery(query, vocabulary) {
  const q = query.toLowerCase();
  const hits = new Map(); // query_key -> matched phrases
  for (const entry of vocabulary) {
    for (const phrase of entry.phrases) {
      if (q.includes(phrase.toLowerCase())) {
        if (!hits.has(entry.query_key)) hits.set(entry.query_key, []);
        hits.get(entry.query_key).push(phrase);
      }
    }
  }
  if (hits.size === 0) return { status: "unsupported" };
  if (hits.size > 1) return { status: "ambiguous", candidates: [...hits.keys()].sort() };
  const [query_key] = [...hits.keys()];
  return { status: "ok", query_key, matchedPhrases: hits.get(query_key) };
}

/**
 * Partial-coverage heuristic: after removing the matched phrases, count
 * remaining content tokens. More than 3 -> the query asks for more than
 * the single mapped key covers (MEDIUM confidence territory).
 */
export function isPartialCoverage(query, matchedPhrases) {
  let rest = query.toLowerCase();
  for (const p of matchedPhrases) {
    rest = rest.split(p.toLowerCase()).join(" ");
  }
  const tokens = rest
    .split(/[^a-z0-9-]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
  return tokens.length >= 3;
}
