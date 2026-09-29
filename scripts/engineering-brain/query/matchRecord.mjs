import { tokenize, normalizePhrase } from "./tokenize.mjs";
import { extractContentTokens } from "../extractContentTokens.mjs";

// The searchable metadata text for a record -- everything the manifest itself carries without
// touching git: path, symbol/section identifier, and any structured details (table name, route
// path, dependency group, SQL object name). This is always available, at zero I/O cost, which is
// why it's the primary match surface; content search (see searchRecords.mjs) is a bounded add-on.
export function buildMetadataText(record) {
  const parts = [record.source_path, record.symbol_or_section, record.source_type];
  if (record.details) {
    for (const value of Object.values(record.details)) {
      if (typeof value === "string") parts.push(value);
      if (Array.isArray(value)) parts.push(...value.filter((v) => typeof v === "string"));
    }
  }
  if (record.version) parts.push(record.version);
  return parts.filter(Boolean).join(" ");
}

// The full pass-1 retrieval surface: metadata text plus the record's indexed content tokens.
// Records mined before content tokens existed simply have no `content_tokens` field and behave
// exactly as before -- the tokens only ever ADD candidate matches, never remove them.
export function buildRetrievalText(record) {
  const metadataText = buildMetadataText(record);
  const tokens = Array.isArray(record.content_tokens) ? record.content_tokens.join(" ") : "";
  return tokens ? `${metadataText} ${tokens}` : metadataText;
}

// Returns the match signals ranking (requirement 4) is built from. `contentText`, when supplied, is
// the record's actual re-fetched file content (see searchRecords.mjs) -- optional, since content
// search is a bounded enhancement over the always-available metadata search. Pass 1 always scores
// against buildRetrievalText (metadata + indexed content tokens), so content terms retrieve
// candidates even when the bounded content-fetch pass never runs (notably on Vercel, where there
// is no git checkout to fetch from).
export function matchRecord(record, { queryTokens, queryPhrase }, contentText = null) {
  const retrievalText = buildRetrievalText(record);
  // Token overlap scores against the FILTERED content signal -- the same pipeline the index uses
  // (stopwords dropped, min length 3, identifiers split). Raw file content is full of noise tokens
  // ("t", "as", "why") that long files match by sheer size; scoring overlap on raw content lets a
  // 2000-line file outrank the 60-line file that actually answers the query. Filtering both sides
  // through the same vocabulary keeps the comparison honest. Exact-phrase matching still runs
  // against the raw content so multi-word phrases keep working.
  const tokenHaystack = contentText
    ? `${retrievalText} ${extractContentTokens(contentText).join(" ")}`
    : retrievalText;
  const phraseHaystack = contentText ? `${retrievalText} ${contentText}` : retrievalText;
  const haystackTokens = new Set(tokenize(tokenHaystack));

  const symbolLower = String(record.symbol_or_section || "").toLowerCase();
  // SQL object keys carry a signature suffix ("has_workspace_access(text)") to distinguish overloads
  // -- strip it for exact-match purposes so a bare-name query still counts as an exact symbol match,
  // not just incidental token overlap against whatever file happens to mention the name in passing.
  const bareSymbolLower = symbolLower.replace(/\(.*$/, "");
  const pathLower = String(record.source_path || "").toLowerCase();

  const exactSymbolMatch = queryTokens.length > 0 && queryTokens.some((t) => symbolLower === t || bareSymbolLower === t)
    || (queryPhrase !== null && (symbolLower === queryPhrase || bareSymbolLower === queryPhrase));
  const exactPathMatch = queryTokens.length > 0 && queryTokens.some((t) => pathLower === t)
    || (queryPhrase !== null && pathLower === queryPhrase)
    || (queryPhrase !== null && pathLower.endsWith(`/${queryPhrase}`));
  const exactPhraseMatch = queryPhrase !== null && queryPhrase.length > 0 && phraseHaystack.toLowerCase().includes(queryPhrase);
  const tokenOverlapCount = queryTokens.filter((t) => haystackTokens.has(t)).length;

  return { exactSymbolMatch, exactPathMatch, exactPhraseMatch, tokenOverlapCount, matchedContent: contentText !== null };
}

export function buildQuerySignature(queryText) {
  // queryPhrase is always derived from the raw query text, not just multi-word queries: identifiers
  // like `has_workspace_access` tokenize into three separate words ("has"/"workspace"/"access") for
  // token-overlap purposes, but the query text itself must still exact-match a symbol_or_section
  // that equals that identifier verbatim -- otherwise a single-word identifier query can never
  // register as an exact match, only as token overlap indistinguishable from any file that happens
  // to mention all three words separately.
  const trimmed = (queryText || "").trim();
  return { queryTokens: tokenize(queryText), queryPhrase: trimmed ? normalizePhrase(trimmed) : null };
}
