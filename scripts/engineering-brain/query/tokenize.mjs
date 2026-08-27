// Deterministic, locale-independent tokenizer: lowercase, split on any run of non-alphanumeric
// characters, drop empties. Same input always produces the same token list -- no stemming, no
// stopword removal, nothing that could vary by environment or library version.
export function tokenize(text) {
  if (!text) return [];
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

export function normalizePhrase(text) {
  return (text || "").toLowerCase().trim().replace(/\s+/g, " ");
}
