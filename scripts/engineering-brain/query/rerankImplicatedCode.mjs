import { tokenize } from "./tokenize.mjs";

// Evidence tiers, lower wins. Deterministic and explainable: every promotion names
// the path or token that caused it via the `evidence_match` annotation.
export const TIER_EXACT_PATH = 0;
export const TIER_BASENAME_OR_SUFFIX = 1;
export const TIER_SYMBOL_TOKEN = 2;
export const TIER_NO_MATCH = 3;

// Minimum shared trailing path segments for a suffix-overlap match. 2 keeps it
// meaningful ("bundle/nsis/x" is diagnostic; a lone "x" filename is tier 1 already
// via basename, and single generic dir names like "src" would be noise).
const MIN_SUFFIX_SEGMENTS = 2;
// Minimum shared trailing *directory* segments (filenames ignored) for a
// near-miss directory match. 3+ names a real location ("target/release/bundle/nsis")
// rather than a coincidence. This is the Capture case: the log named
// forge-capture-app/app/target/release/bundle/nsis/forge-capture-setup.exe while
// the indexed source lives at forge-capture-app/target/release/bundle/nsis/....
const MIN_DIR_SUFFIX_SEGMENTS = 3;

/** Normalize a path for comparison: forward slashes, lowercase, no leading ./ or trailing /. */
export function normalizeEvidencePath(p) {
  return String(p || "")
    .replace(/\\/g, "/")
    .toLowerCase()
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
}

function basename(p) {
  const n = normalizeEvidencePath(p);
  const i = n.lastIndexOf("/");
  return i === -1 ? n : n.slice(i + 1);
}

function segments(p) {
  return normalizeEvidencePath(p).split("/").filter(Boolean);
}

/** Length of the longest shared trailing segment run between two paths. */
function sharedTrailingSegments(aSegs, bSegs) {
  let n = 0;
  const max = Math.min(aSegs.length, bSegs.length);
  for (let i = 1; i <= max; i += 1) {
    if (aSegs[aSegs.length - i] === bSegs[bSegs.length - i]) n += 1;
    else break;
  }
  return n;
}

/**
 * Match one implicated-code entry against one evidence signal.
 * Entry shape: the flat facet entry from assembleDiagnosticContext
 * ({ source_path, source_type, symbol_or_section, ... }).
 * Evidence shape: { failed_step, error_lines[], mentioned_paths[] }.
 * Returns { tier, matched_path, matched_tokens } — always tiered, never throws.
 */
export function matchEvidenceTier(entry, evidence) {
  const none = { tier: TIER_NO_MATCH, matched_path: null, matched_tokens: [] };
  if (!entry || !evidence) return none;

  const entryPath = normalizeEvidencePath(entry.source_path);
  if (!entryPath) return none;

  const mentioned = Array.isArray(evidence.mentioned_paths) ? evidence.mentioned_paths : [];
  const normalizedMentioned = mentioned.map(normalizeEvidencePath).filter(Boolean);

  // Tier 0: the exact indexed path was named in the failure log.
  for (const m of normalizedMentioned) {
    if (m === entryPath) {
      return { tier: TIER_EXACT_PATH, matched_path: m, matched_tokens: [] };
    }
  }

  // Tier 1: basename equality, a shared trailing path run, or a shared trailing
  // directory run with a different filename (the Capture near-miss: the log named
  // forge-capture-app/app/target/release/bundle/nsis/*.exe while the indexed
  // source lives at forge-capture-app/target/release/bundle/nsis/...).
  const entryBase = basename(entryPath);
  const entrySegs = segments(entryPath);
  for (const m of normalizedMentioned) {
    if (basename(m) === entryBase && entryBase) {
      return { tier: TIER_BASENAME_OR_SUFFIX, matched_path: m, matched_tokens: [] };
    }
    if (sharedTrailingSegments(entrySegs, segments(m)) >= MIN_SUFFIX_SEGMENTS) {
      return { tier: TIER_BASENAME_OR_SUFFIX, matched_path: m, matched_tokens: [] };
    }
    const entryDirs = entrySegs.slice(0, -1);
    const mentionedDirs = segments(m).slice(0, -1);
    if (sharedTrailingSegments(entryDirs, mentionedDirs) >= MIN_DIR_SUFFIX_SEGMENTS) {
      return { tier: TIER_BASENAME_OR_SUFFIX, matched_path: m, matched_tokens: [] };
    }
  }

  // Tier 2: a symbol token from the entry appears in the failure text.
  // Symbol-first keeps this precise: path tokens alone ("forge", "app") would be noise.
  const errorText = [
    evidence.failed_step || "",
    ...(Array.isArray(evidence.error_lines) ? evidence.error_lines : []),
  ].join("\n");
  const errorTokens = new Set(tokenize(errorText));
  if (errorTokens.size > 0) {
    const symbolTokens = tokenize(entry.symbol_or_section || entryBase);
    const hits = symbolTokens.filter((t) => errorTokens.has(t));
    if (hits.length > 0) {
      return { tier: TIER_SYMBOL_TOKEN, matched_path: null, matched_tokens: [...new Set(hits)] };
    }
  }

  return none;
}

/**
 * Re-rank implicated-code facet entries using one deterministic evidence signal.
 * Pure: returns a new array, original order preserved within a tier (stable).
 * Each returned entry carries an `evidence_match` annotation for auditability.
 * No evidence (or empty evidence) → entries come back in their original order.
 */
export function rerankImplicatedCode(entries, evidenceSignal) {
  const list = Array.isArray(entries) ? entries : [];
  const hasEvidence = evidenceSignal
    && ((Array.isArray(evidenceSignal.mentioned_paths) && evidenceSignal.mentioned_paths.length > 0)
      || (Array.isArray(evidenceSignal.error_lines) && evidenceSignal.error_lines.length > 0)
      || (evidenceSignal.failed_step && String(evidenceSignal.failed_step).trim().length > 0));
  if (!hasEvidence) return [...list];

  const decorated = list.map((entry, index) => ({
    entry,
    index,
    match: matchEvidenceTier(entry, evidenceSignal),
  }));
  decorated.sort((a, b) => (a.match.tier - b.match.tier) || (a.index - b.index));
  return decorated.map(({ entry, match }) => ({ ...entry, evidence_match: match }));
}
