/**
 * extractContentTokens.mjs — deterministic content-term extraction for retrieval.
 *
 * The query path's pass-1 retrieval gates on metadata (path/symbol/details) token overlap, so a
 * file whose name and symbols never mention the query's words is invisible no matter how relevant
 * its content is. These content tokens close that gap: the indexer stores a bounded, sorted token
 * list per file, and matchRecord treats those tokens as part of the always-available (zero-I/O)
 * retrieval surface -- content terms participate in initial candidate retrieval, not just the
 * bounded content re-rank pass.
 *
 * Deterministic: lowercase, identifier-aware splitting, stopword/length filtering, frequency
 * ordering with alphabetical tiebreak, hard cap. Same content always yields the same tokens, on
 * any machine, with no model calls and no external state.
 */

// Shared with searchBugCatalog.mjs: words too common to be useful retrieval terms. Query terms
// that never appear here simply don't contribute to content-token overlap -- which is the point:
// "why is the dashboard slow" should retrieve on "dashboard", not on "why"/"the".
export const CONTENT_TOKEN_STOPWORDS = new Set(
  'a,an,the,and,or,of,to,in,on,for,with,from,by,at,as,is,are,was,were,be,been,it,its,this,that,these,those,i,you,we,they,he,she,my,our,your,how,what,why,when,where,which,who,do,does,did,not,no,yes,if,then,than,so,such,can,could,should,would,will,just,about,into,over,after,before,between,fix,fixing,fixed,bug,error,issue,broken,breaks'.split(
    ',',
  ),
);

// Hard bound: no file contributes more than this many tokens, so the manifest/sidecar/DB column
// stay small and pass-1 scoring stays cheap no matter how large a file gets.
export const MAX_CONTENT_TOKENS_PER_FILE = 128;

const MIN_TOKEN_LENGTH = 3;

// Split an alphanumeric run on camelCase/PascalCase boundaries: "loanPaymentCategory" ->
// ["loan", "payment", "category"], "HTTPHandler" -> ["http", "handler"]. The whole run is also
// kept (see below), so identifier-style queries still match verbatim.
function splitIdentifier(run) {
  return run
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(' ')
    .filter(Boolean);
}

/**
 * Extract the bounded retrieval-token list for one file's content.
 * Returns a sorted-by-importance array of unique lowercase tokens: most frequent first,
 * alphabetical tiebreak, capped at MAX_CONTENT_TOKENS_PER_FILE.
 */
export function extractContentTokens(content) {
  const text = String(content || '');
  if (!text) return [];

  const frequencies = new Map();
  // Match runs case-sensitively FIRST: camelCase splitting needs the original case boundaries.
  // Each run contributes its lowercase whole form plus its lowercase identifier parts.
  const runs = text.match(/[a-zA-Z0-9]+/g) || [];
  for (const run of runs) {
    const variants = new Set([run.toLowerCase(), ...splitIdentifier(run).map((p) => p.toLowerCase())]);
    for (const token of variants) {
      if (token.length < MIN_TOKEN_LENGTH) continue;
      if (/^[0-9]+$/.test(token)) continue;
      if (CONTENT_TOKEN_STOPWORDS.has(token)) continue;
      frequencies.set(token, (frequencies.get(token) || 0) + 1);
    }
  }

  return [...frequencies.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, MAX_CONTENT_TOKENS_PER_FILE)
    .map(([token]) => token);
}
