import { tokenize, normalizePhrase } from "./tokenize.mjs";

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

// Returns the match signals ranking (requirement 4) is built from. `contentText`, when supplied, is
// the record's actual re-fetched file content (see searchRecords.mjs) -- optional, since content
// search is a bounded enhancement over the always-available metadata search.
export function matchRecord(record, { queryTokens, queryPhrase }, contentText = null) {
  const metadataText = buildMetadataText(record);
  const haystack = contentText ? `${metadataText} ${contentText}` : metadataText;
  const haystackLower = haystack.toLowerCase();
  const haystackTokens = new Set(tokenize(haystack));

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
  const exactPhraseMatch = queryPhrase !== null && queryPhrase.length > 0 && haystackLower.includes(queryPhrase);
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
