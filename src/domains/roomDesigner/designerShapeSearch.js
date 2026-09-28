// One search across everything the designer can place: palette tools
// (including saved custom shapes offered as tools), the furniture catalog,
// and every registered symbol domain (building elements, site, MEP,
// process equipment incl. TEMA, piping).
//
// buildShapeSearchIndex(...) -> entries; searchShapes(index, query, limit)
// -> ranked results. Every query word must match (name or category), in any
// order. Ranking: exact name, name prefix, word-start in the name, substring
// in the name, then category-only matches. Pure and framework-free.

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * @param {{ tools?: Array<{id,label}>, furniture?: Array<{id,label,category}>,
 *           symbolSets?: Array<{domain,title,symbols}> }} sources
 */
export function buildShapeSearchIndex({ tools = [], furniture = [], symbolSets = [] } = {}) {
  const entries = [];
  const add = (entry) => entries.push({ ...entry, name: norm(entry.label), where: norm(entry.group) });
  for (const t of tools) add({ kind: "tool", id: t.id, label: t.label, group: "Tools" });
  for (const f of furniture) add({ kind: "catalog", domain: "furniture", id: f.id, label: f.label, group: `Furniture · ${f.category || ""}` });
  for (const set of symbolSets) {
    if (set.domain === "furniture" || set.domain === "rooms") continue; // furniture comes from the catalog above
    for (const s of set.symbols) {
      add({ kind: "symbol", domain: set.domain, id: s.id, label: s.label, group: `${set.title}${s.category ? ` · ${s.category}` : ""}` });
    }
  }
  return entries;
}

function score(entry, words, phrase) {
  let best = 0;
  if (entry.name === phrase) best = 5;
  else if (entry.name.startsWith(phrase)) best = 4;
  for (const w of words) {
    const inName = entry.name.includes(w);
    if (!inName && !entry.where.includes(w)) return 0; // every word must match somewhere
  }
  if (best) return best;
  if (words.every((w) => entry.name.split(" ").some((part) => part.startsWith(w)))) return 3;
  if (words.every((w) => entry.name.includes(w))) return 2;
  return 1; // at least one word only in the category
}

/** Ranked results for `query` (at most `limit`). */
export function searchShapes(index, query, limit = 30) {
  const phrase = norm(query);
  if (!phrase) return [];
  const words = phrase.split(" ");
  const kindOrder = { tool: 0, catalog: 1, symbol: 2 };
  return index
    .map((entry, order) => ({ entry, order, s: score(entry, words, phrase) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || kindOrder[a.entry.kind] - kindOrder[b.entry.kind] || a.order - b.order)
    .slice(0, limit)
    .map(({ entry }) => {
      const { name, where, ...rest } = entry;
      void name;
      void where;
      return rest;
    });
}
