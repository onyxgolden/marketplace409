/**
 * searchBugCatalog.mjs — rank bug-catalog records against a query.
 *
 * Pure, deterministic, no model calls. Scores each record by keyword
 * overlap between the query and the record's subject + touched files:
 * subject terms weigh double, file-path terms single. Ties break by
 * recency (newer first), then SHA — so identical inputs always produce
 * identical rankings.
 */

const STOPWORDS = new Set(
  'a,an,the,and,or,of,to,in,on,for,with,from,by,at,as,is,are,was,were,be,been,it,its,this,that,these,those,i,you,we,they,he,she,my,our,your,how,what,why,when,where,which,who,do,does,did,not,no,yes,if,then,than,so,such,can,could,should,would,will,just,about,into,over,after,before,between,fix,fixing,fixed,bug,error,issue,broken,breaks'.split(
    ',',
  ),
);

export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/**
 * Score one record against pre-tokenized query terms.
 * Returns { score, matchedTerms } — score 0 means no overlap.
 */
export function scoreRecord(record, queryTerms) {
  const subjectTerms = new Set(tokenize(record.subject));
  const fileTerms = new Set();
  for (const f of record.files || []) {
    for (const t of tokenize(f)) fileTerms.add(t);
  }
  let score = 0;
  const matchedTerms = [];
  for (const q of queryTerms) {
    let hit = false;
    if (subjectTerms.has(q)) {
      score += 2;
      hit = true;
    }
    if (fileTerms.has(q)) {
      score += 1;
      hit = true;
    }
    if (hit) matchedTerms.push(q);
  }
  return { score, matchedTerms };
}

/**
 * Rank bug-catalog records against a query string.
 * Returns at most maxResults entries: { record, score, matched_terms },
 * sorted by score desc, then date desc, then sha asc.
 */
export function searchBugCatalog({ records, queryText, maxResults = 5 }) {
  const queryTerms = [...new Set(tokenize(queryText))];
  if (queryTerms.length === 0 || !Array.isArray(records)) return [];
  const scored = [];
  for (const record of records) {
    const { score, matchedTerms } = scoreRecord(record, queryTerms);
    if (score > 0) scored.push({ record, score, matched_terms: matchedTerms });
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const da = a.record.date || '';
    const db = b.record.date || '';
    if (db !== da) return db < da ? -1 : 1;
    return a.record.sha < b.record.sha ? -1 : 1;
  });
  return scored.slice(0, maxResults);
}
