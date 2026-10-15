/**
 * extraction.js — deterministic extraction from the supported fixture
 * code grammar (fgv1) and documented-value parsing per behavior key.
 *
 * Bounded fixture behaviors: retry-limit, holdback-pct, rounding-mode,
 * feature-flag:<name>, status-map. Deterministic extraction from
 * supported code fixture grammars plus registered usage context; unknown
 * code/behavior -> UNVERIFIABLE. A bare/dead constant, comment, test
 * expectation alone or arbitrary caller annotation never proves
 * production behavior. Complete path selection must be established for
 * versioned v1/v2 code; conflicting active paths are retained, not
 * averaged. Pure Node 24 ESM, zero dependencies.
 */

export const BEHAVIORS = ["retry-limit", "holdback-pct", "rounding-mode", "feature-flag", "status-map"];

/** Split a behavior_key into {behavior, arg}. feature-flag:<name>. */
export function parseBehaviorKey(behaviorKey) {
  const idx = behaviorKey.indexOf(":");
  if (idx < 0) return { behavior: behaviorKey, arg: null };
  return { behavior: behaviorKey.slice(0, idx), arg: behaviorKey.slice(idx + 1) };
}

export function isKnownBehavior(behaviorKey) {
  const { behavior, arg } = parseBehaviorKey(behaviorKey);
  if (!BEHAVIORS.includes(behavior)) return false;
  if (behavior === "feature-flag") return typeof arg === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(arg);
  return arg === null;
}

// ---------------------------------------------------------------------------
// Code fixture grammar (fgv1)
// ---------------------------------------------------------------------------

const RE_ACTIVE = /^\s*#\s*active-versions\s*:\s*(.+?)\s*$/;
const RE_SECTION = /^\s*#\s*version\s*:\s*(v\d+)\s*$/;
const RE_TEST = /^\s*#\s*test\s*:/;
const RE_COMMENT = /^\s*#/;
const RE_CONST_INT = /^\s*const\s+([A-Z][A-Z0-9_]*)\s*=\s*(-?\d+)\s*;\s*$/;
const RE_CONST_STR = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*"([^"]*)"\s*;\s*$/;
const RE_FEATURE_FLAGS = /^\s*FEATURE_FLAGS\s*=\s*\{\s*(.+?)\s*\}\s*;\s*$/;
const RE_STATUS_MAP = /^\s*STATUS_MAP\s*=\s*\{\s*(.+?)\s*\}\s*;\s*$/;
const RE_FLAG_ENTRY = /([A-Za-z0-9_-]+)\s*:\s*\{\s*enabled\s*:\s*(true|false)\s*\}/g;
const RE_MAP_ENTRY = /([A-Z][A-Z0-9_]*)\s*:\s*(\d{1,5})/g;
const RE_CONST_ASSIGN_UNKNOWN = /^\s*(?:const\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.+?)\s*;\s*$/;

const USAGE_PATTERNS = [
  { behavior: "retry-limit", re: /^\s*retry_queue\.configure\(\s*(\w+)\s*\)\s*;\s*$/ },
  { behavior: "holdback-pct", re: /^\s*apply_holdback\(\s*\w+\s*,\s*(\w+)\s*\)\s*;\s*$/ },
  { behavior: "rounding-mode", re: /^\s*set_rounding\(\s*(\w+)\s*\)\s*;\s*$/ },
  { behavior: "feature-flag", re: /^\s*if\s*\(\s*is_enabled\(\s*"([\w-]+)"\s*\)\s*\)/ },
  { behavior: "status-map", re: /^\s*return\s+STATUS_MAP\[\s*\w+\s*\]\s*;\s*$/ },
];

const DECL_CONST = { "retry-limit": "MAX_RETRIES", "holdback-pct": "HOLDBACK_PCT", "rounding-mode": "ROUNDING_MODE" };

/**
 * Parse one code fixture text into evidence spans.
 * Returns {activeVersions:[...], spans:[{span_id, kind, behavior, arg, value,
 * value_ok, ref_name, version, start_byte, end_byte, quoted_text}], unknownLines}.
 * Byte offsets are UTF-8 over the full fixture text.
 */
export function parseCodeFixture(text) {
  const spans = [];
  const unknownLines = [];
  let activeVersions = null;
  let section = null; // null = preamble (belongs to no version)
  let sawSection = false;
  let offset = 0;
  const lines = text.split("\n");

  const pushSpan = (spanId, kind, behavior, arg, value, valueOk, refName, quotedText, startByte) => {
    spans.push({
      span_id: spanId,
      kind,
      behavior,
      arg,
      value,
      value_ok: valueOk,
      ref_name: refName,
      version: section,
      start_byte: startByte,
      end_byte: startByte + Buffer.byteLength(quotedText, "utf8"),
      quoted_text: quotedText,
    });
  };

  for (const rawLine of lines) {
    const line = rawLine;
    const trimmed = line.trim();
    const startByte = offset;
    offset += Buffer.byteLength(line, "utf8") + 1;

    if (trimmed.length === 0) continue;
    let m;
    if ((m = RE_ACTIVE.exec(trimmed))) {
      activeVersions = m[1].split(/\s+/).filter(Boolean);
      continue;
    }
    if ((m = RE_SECTION.exec(trimmed))) {
      section = m[1];
      sawSection = true;
      continue;
    }
    if (RE_TEST.test(trimmed) || RE_COMMENT.test(trimmed)) continue;

    // Declarations.
    if ((m = RE_CONST_INT.exec(trimmed))) {
      const name = m[1];
      const behavior = Object.keys(DECL_CONST).find((b) => DECL_CONST[b] === name);
      if (behavior) {
        pushSpan(`decl:${name}@${section ?? "global"}`, "declaration", behavior, null, parseInt(m[2], 10), true, name, line, startByte);
      }
      continue;
    }
    if ((m = RE_CONST_STR.exec(trimmed))) {
      const name = m[1];
      if (name === "ROUNDING_MODE") {
        pushSpan(`decl:${name}@${section ?? "global"}`, "declaration", "rounding-mode", null, m[2], true, name, line, startByte);
      }
      continue;
    }
    if ((m = RE_FEATURE_FLAGS.exec(trimmed))) {
      RE_FLAG_ENTRY.lastIndex = 0;
      let e;
      while ((e = RE_FLAG_ENTRY.exec(m[1])) !== null) {
        pushSpan(
          `decl:FEATURE_FLAGS:${e[1]}@${section ?? "global"}`,
          "declaration", "feature-flag", e[1], e[2] === "true", true, e[1], line, startByte
        );
      }
      continue;
    }
    if ((m = RE_STATUS_MAP.exec(trimmed))) {
      RE_MAP_ENTRY.lastIndex = 0;
      let e;
      while ((e = RE_MAP_ENTRY.exec(m[1])) !== null) {
        pushSpan(
          `decl:STATUS_MAP:${e[1]}@${section ?? "global"}`,
          "declaration", "status-map", e[1],
          { code: e[1], status: parseInt(e[2], 10) }, true, e[1], line, startByte
        );
      }
      continue;
    }

    // Usage spans.
    let usageMatched = false;
    for (const u of USAGE_PATTERNS) {
      const um = u.re.exec(trimmed);
      if (um) {
        const refName = um[1] ?? null;
        const arg = u.behavior === "feature-flag" ? refName : null;
        pushSpan(
          `usage:${u.behavior}${arg ? ":" + arg : ""}@${section ?? "global"}`,
          "usage", u.behavior, arg, null, true, refName, line, startByte
        );
        usageMatched = true;
        break;
      }
    }
    if (usageMatched) continue;

    // Unknown grammar: an assignment-shaped line we cannot parse is an
    // unknown value for a tracked constant; anything else is ignored.
    if ((m = RE_CONST_ASSIGN_UNKNOWN.exec(trimmed))) {
      const name = m[1];
      const behavior = Object.keys(DECL_CONST).find((b) => DECL_CONST[b] === name) ??
        (name === "ROUNDING_MODE" ? "rounding-mode" : null);
      if (behavior) {
        pushSpan(`decl:${name}@${section ?? "global"}`, "declaration", behavior, null, null, false, name, line, startByte);
      } else {
        unknownLines.push({ line, start_byte: startByte });
      }
      continue;
    }
    unknownLines.push({ line, start_byte: startByte });
  }

  if (!activeVersions || activeVersions.length === 0) activeVersions = ["v1"];
  // Fixtures without any version section marker: every span belongs to the
  // single implicit version (activeVersions[0]).
  if (!sawSection) {
    for (const s of spans) {
      s.version = activeVersions[0];
      s.span_id = s.span_id.replace(/@global$/, `@${activeVersions[0]}`);
    }
  }
  // Deduplicate span_ids (byte-identical duplicate lines collapse to one span).
  const seen = new Set();
  const deduped = [];
  for (const s of spans) {
    const key = `${s.span_id}|${s.start_byte}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(s);
    }
  }
  return { activeVersions, spans: deduped, unknownLines };
}

// ---------------------------------------------------------------------------
// Documented-value parsing per behavior key
// ---------------------------------------------------------------------------

const RE_DOC_INT_ATTEMPTS = /(\d+)\s*(attempts?|retries|times)/i;
const RE_DOC_PERCENT = /(\d+)\s*(percent|%)/i;
const RE_DOC_ROUNDING = /(half-up|half-even|half-down|bankers|round-up|round-down|up|down)/i;
const RE_DOC_FLAG = /\b(enabled|disabled)\b/i;
const RE_DOC_STATUS = /([A-Z][A-Z0-9_]*)\s*(?:→|->|maps to)\s*(\d{3})/;

/**
 * Parse the documented value from a verified doc quoted_text.
 * Returns {ok, value, phrase, phrase_start, phrase_end} where phrase is
 * the exact matched substring (relative offsets into quoted_text), or
 * {ok:false, reason}.
 */
export function parseDocValue(behaviorKey, quotedText) {
  const { behavior, arg } = parseBehaviorKey(behaviorKey);
  let m;
  switch (behavior) {
    case "retry-limit":
      m = RE_DOC_INT_ATTEMPTS.exec(quotedText);
      if (!m) return { ok: false, reason: "DOC_VALUE_UNPARSEABLE" };
      return { ok: true, value: parseInt(m[1], 10), phrase: m[0], phrase_start: m.index, phrase_end: m.index + m[0].length };
    case "holdback-pct":
      m = RE_DOC_PERCENT.exec(quotedText);
      if (!m) return { ok: false, reason: "DOC_VALUE_UNPARSEABLE" };
      return { ok: true, value: parseInt(m[1], 10), phrase: m[0], phrase_start: m.index, phrase_end: m.index + m[0].length };
    case "rounding-mode": {
      m = RE_DOC_ROUNDING.exec(quotedText);
      if (!m) return { ok: false, reason: "DOC_VALUE_UNPARSEABLE" };
      const norm = { "round-up": "up", "round-down": "down" }[m[1].toLowerCase()] ?? m[1].toLowerCase();
      return { ok: true, value: norm, phrase: m[0], phrase_start: m.index, phrase_end: m.index + m[0].length };
    }
    case "feature-flag":
      m = RE_DOC_FLAG.exec(quotedText);
      if (!m) return { ok: false, reason: "DOC_VALUE_UNPARSEABLE" };
      return { ok: true, value: m[1].toLowerCase() === "enabled", phrase: m[0], phrase_start: m.index, phrase_end: m.index + m[0].length };
    case "status-map":
      m = RE_DOC_STATUS.exec(quotedText);
      if (!m) return { ok: false, reason: "DOC_VALUE_UNPARSEABLE" };
      return {
        ok: true,
        value: { code: m[1], status: parseInt(m[2], 10) },
        phrase: m[0], phrase_start: m.index, phrase_end: m.index + m[0].length,
      };
    default:
      return { ok: false, reason: "UNKNOWN_BEHAVIOR" };
  }
}

/** Render a code-side value in the doc's phrase style for the `after` text. */
export function renderValue(behaviorKey, codeValue) {
  const { behavior } = parseBehaviorKey(behaviorKey);
  switch (behavior) {
    case "retry-limit": return `${codeValue} attempts`;
    case "holdback-pct": return `${codeValue} percent`;
    case "rounding-mode": return String(codeValue);
    case "feature-flag": return codeValue ? "enabled" : "disabled";
    case "status-map": return `${codeValue.code} maps to ${codeValue.status}`;
    default: return String(codeValue);
  }
}

export function valuesEqual(behaviorKey, docValue, codeValue) {
  const { behavior } = parseBehaviorKey(behaviorKey);
  if (behavior === "status-map") return docValue.code === codeValue.code && docValue.status === codeValue.status;
  return docValue === codeValue;
}

// ---------------------------------------------------------------------------
// Effective code value with usage and version rules
// ---------------------------------------------------------------------------

/**
 * Determine the effective production value for a behavior across the
 * parsed code fixtures (non-quarantined only).
 *
 * Rules:
 * - No declaration anywhere -> {outcome:"NO_CODE_EVIDENCE"}.
 * - Declaration exists but its value failed grammar parse ->
 *   {outcome:"UNKNOWN_GRAMMAR_VALUE"}.
 * - Declaration with zero usage spans in its version -> DEAD_CONSTANT
 *   (a bare constant never proves production behavior).
 * - Usage referencing a different identifier than the declared constant
 *   (or multiple conflicting usages) -> AMBIGUOUS_USAGE.
 * - required_usage_span_ids must each resolve to a usage span of this
 *   behavior, else USAGE_REQUIREMENT_UNMET.
 * - Active v1/v2 versions with different effective values ->
 *   PATH_CONFLICT (values retained, never averaged).
 *
 * Returns {outcome, value?, citations?, usageCitations?, versions?, detail?}.
 */
export function effectiveCodeValue(behaviorKey, parsedFixtures) {
  const { behavior, arg } = parseBehaviorKey(behaviorKey);
  const perVersion = new Map(); // version -> {decls:[], usages:[]}

  for (const pf of parsedFixtures) {
    for (const v of pf.parsed.activeVersions) {
      if (!perVersion.has(v)) perVersion.set(v, { decls: [], usages: [] });
    }
    for (const s of pf.parsed.spans) {
      if (s.behavior !== behavior) continue;
      if (arg !== null && s.arg !== arg) continue;
      const bucket = perVersion.get(s.version);
      if (!bucket) continue; // span outside any active version section
      if (s.kind === "declaration") bucket.decls.push({ ...s, fixture: pf });
      else bucket.usages.push({ ...s, fixture: pf });
    }
  }

  const allDecls = [...perVersion.values()].flatMap((b) => b.decls);
  if (allDecls.length === 0) return { outcome: "NO_CODE_EVIDENCE" };
  if (allDecls.some((d) => !d.value_ok)) return { outcome: "UNKNOWN_GRAMMAR_VALUE" };

  const versionValues = [];
  for (const [version, bucket] of perVersion) {
    if (bucket.decls.length === 0) continue;
    // Usage attribution: the usage must reference the declared constant.
    const decl = bucket.decls[0];
    const expectedRef = behavior === "feature-flag" ? decl.arg
      : behavior === "status-map" ? null
      : DECL_CONST[behavior];
    const attributed = bucket.usages.filter((u) => {
      if (behavior === "status-map") return true; // STATUS_MAP[code] consults the map
      if (behavior === "feature-flag") return u.ref_name === decl.arg;
      return u.ref_name === expectedRef;
    });
    const unattributed = bucket.usages.filter((u) => !attributed.includes(u));
    if (bucket.usages.length === 0) {
      versionValues.push({ version, outcome: "DEAD_CONSTANT", decl });
    } else if (unattributed.length > 0 || attributed.length === 0) {
      versionValues.push({ version, outcome: "AMBIGUOUS_USAGE", decl, usages: bucket.usages });
    } else {
      versionValues.push({ version, outcome: "OK", decl, usages: attributed });
    }
  }

  const okVersions = versionValues.filter((v) => v.outcome === "OK");
  if (okVersions.length === 0) {
    // Report the most informative failure across versions (deterministic order).
    const order = ["AMBIGUOUS_USAGE", "UNKNOWN_GRAMMAR_VALUE", "DEAD_CONSTANT"];
    versionValues.sort((a, b) => order.indexOf(a.outcome) - order.indexOf(b.outcome));
    const first = versionValues[0];
    return {
      outcome: first.outcome,
      detail: first,
      citations: [first.decl],
      usageCitations: first.usages ?? [],
    };
  }

  // Conflicting active paths are retained, never averaged.
  const distinct = new Map();
  for (const v of okVersions) {
    const key = JSON.stringify(v.decl.value);
    if (!distinct.has(key)) distinct.set(key, []);
    distinct.get(key).push(v.version);
  }
  if (distinct.size > 1) {
    return {
      outcome: "PATH_CONFLICT",
      values: [...distinct.entries()].map(([value, versions]) => ({ value: JSON.parse(value), versions })),
      citations: okVersions.map((v) => v.decl),
      usageCitations: okVersions.flatMap((v) => v.usages),
    };
  }
  const winner = okVersions[0];
  return {
    outcome: "OK",
    value: winner.decl.value,
    citations: okVersions.map((v) => v.decl),
    usageCitations: okVersions.flatMap((v) => v.usages),
    versions: okVersions.map((v) => v.version),
  };
}

/**
 * Check caller-required usage span IDs: each must resolve to a usage
 * evidence span of the same behavior. Returns {ok, missing:[ids]}.
 */
export function checkRequiredUsageSpanIds(requiredIds, behaviorKey, parsedFixtures) {
  const { behavior, arg } = parseBehaviorKey(behaviorKey);
  const missing = [];
  for (const id of requiredIds) {
    let found = false;
    for (const pf of parsedFixtures) {
      for (const s of pf.parsed.spans) {
        if (s.span_id === id && s.kind === "usage" && s.behavior === behavior && (arg === null || s.arg === arg)) {
          found = true;
          break;
        }
      }
      if (found) break;
    }
    if (!found) missing.push(id);
  }
  return { ok: missing.length === 0, missing };
}
