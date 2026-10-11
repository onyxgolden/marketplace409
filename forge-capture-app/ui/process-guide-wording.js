// FORGE Capture — Process Training PT-6 Slice W wording prototype
// (ui/process-guide-wording.js).
//
// Pure, deterministic, fixture-only wording pass: turns a PT-2 compiled
// guide (`source: "fixture"`, `status: "draft_unverified"`) into an
// in-memory guide whose steps each carry a normalized `wording` field,
// plus a deterministic `diffReport`. No DOM, no Tauri, no filesystem,
// no network, no AI calls, no clock reads — the engine never consults
// the host clock; `provenanceTime` is a caller-injected RFC 3339 string
// copied verbatim into the output. See the structural test in
// `__tests__/process-guide-wording.test.js` that scans this file's own
// source for exactly those things and fails if any appear.
//
// THIS MODULE NEVER CAPTURES OR PERSISTS ANYTHING. It accepts only an
// already-compiled fixture guide and returns an in-memory
// JSON-serializable `{ guide, diffReport }` — nothing is written to
// disk, nothing is sent anywhere, nothing is exported. A real/live
// guide input is refused before any wording is produced (see W5), with
// only safe metadata (code, supplied source value, ruleset identity —
// never guide contents) in the thrown `WordingError`'s attempt record.
//
// Source-token rule (PT6-D1): every existing UI label, control name,
// equipment tag, document identifier, and organization-specific term in
// the guide's own fields is an opaque source span — byte-for-byte
// preserved, never checked against the terminology allowlist, and
// changed in generated wording only through an explicit caller-owned
// mapping entry. Only the template's own literal text (wording newly
// introduced by this pass) is allowlist-gated.
//
// Determinism rule (PT6-D2): the diff report is regenerated from the
// invariant source fields on every run — never from a prior `wording`
// field — so reapplying the pass to its own output with identical
// inputs returns byte-identical semantic output (idempotent, no
// second-pass drift). The diff `before` is the invariant source-wording
// representation (`renderSourceWording`, shared verbatim with the UI's
// Before label) — never the new template re-rendered — so the
// normalization the template performs is exposed, not concealed.

import { GUIDE_SCHEMA_VERSION } from "./process-guide-compiler.js";

export const WORDING_RESULT_SCHEMA_VERSION = 1;

const WORDING_RULESET_SCHEMA_VERSION = 1;
const MAX_MAPPING_ENTRY_LENGTH = 200;
const MAX_SOURCE_SPAN_LENGTH = 1000;
const MAX_PROVENANCE_TIME_LENGTH = 100;
const MAX_TEMPLATE_LENGTH = 2000;
const MAX_ATTEMPT_DETAIL_LENGTH = 300;

// Words that would make generated wording assert an outcome the pass
// must never claim. Checked against template literal text (whole words,
// case-insensitive) before the allowlist check, so a ruleset that
// allowlists one of these still fails closed on the claim itself.
const VERIFICATION_CLAIM_WORDS = new Set([
  "verified",
  "verify",
  "success",
  "successful",
  "succeed",
  "complete",
  "completed",
  "completion",
  "certified",
  "approved",
  "validated",
]);

// Ruleset key names that indicate model/provider/network/executable
// configuration. Any key matching these (case-insensitive, at any depth)
// fails the W9 gate, before the exact-key shape check below.
const FORBIDDEN_CONFIG_KEY_PATTERN =
  /^(model|provider|endpoint|url|uri|callback|oncomplete|onerror|onresult|fetch|xmlhttprequest|websocket|invoke|exec|command|eval|script|network|http|socket|ai|llm|openai|anthropic|gemini|sdk|token|apikey|api_key|secret|password)$/i;

const ALLOWED_RULESET_KEYS = new Set([
  "schemaVersion",
  "rulesetId",
  "rulesetVersion",
  "template",
  "placeholderFields",
  "terminologyAllowlist",
]);

const RFC3339_PATTERN =
  /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,9})?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/;
const PLACEHOLDER_PATTERN = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
const FIELD_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const WORD_TOKEN_PATTERN = /[a-z0-9]+/g;

// W-002 review fix: the supported source-field contract is fixed by the
// slice, independent of caller declarations. The brief permits only
// `action` and `targetLabel` — a caller may not widen it (e.g. to
// `processName` or a fabricated field), and duplicates are rejected,
// before any output is produced.
const SUPPORTED_PLACEHOLDER_FIELDS = new Set(["action", "targetLabel"]);

// Canonical order for the invariant source-wording representation
// (W-001): always action, then targetLabel, joined with an em dash.
const SOURCE_WORDING_FIELD_ORDER = ["action", "targetLabel"];

/**
 * W-001 review fix: the one invariant source-wording representation.
 * This is the baseline both the engine's diff `before` and the UI's
 * Before label use — rendered from the step's own source fields only,
 * never from a prior `wording` field and never from the (new) template,
 * so the template's own phrasing change is exposed by the diff instead
 * of concealed by it. Exported so the UI and the engine use the same
 * string by construction, not by parallel re-implementation.
 */
export function renderSourceWording(spans) {
  return SOURCE_WORDING_FIELD_ORDER
    .filter((field) => typeof spans[field] === "string")
    .map((field) => spans[field])
    .join(" — ");
}

export class WordingError extends Error {
  constructor(code, message, attemptRecord) {
    super(message);
    this.name = "WordingError";
    this.code = code;
    // Bounded, JSON-serializable, plain data only. For non-fixture
    // refusals this carries safe metadata (code, supplied source value,
    // ruleset identity) and never guide contents.
    this.attemptRecord = attemptRecord;
  }
}

function boundDetail(text) {
  return String(text).slice(0, MAX_ATTEMPT_DETAIL_LENGTH);
}

function rulesetIdentity(ruleset) {
  const asObject = ruleset && typeof ruleset === "object" && !Array.isArray(ruleset) ? ruleset : null;
  // Type-preserving but bounded: keep a string/number identity as-is so
  // attempt records stay stable; anything else becomes "missing".
  const id =
    asObject && typeof asObject.rulesetId === "string" && asObject.rulesetId.length > 0
      ? asObject.rulesetId.slice(0, 100)
      : "missing";
  const rawVersion = asObject ? asObject.rulesetVersion : undefined;
  const version =
    typeof rawVersion === "string"
      ? rawVersion.slice(0, 100) || "missing"
      : typeof rawVersion === "number"
        ? rawVersion
        : "missing";
  return { rulesetId: id, rulesetVersion: version };
}

function fail(code, detail, ruleset, extraRecord = {}) {
  throw new WordingError(code, boundDetail(detail), {
    code,
    ...rulesetIdentity(ruleset),
    ...extraRecord,
  });
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

// The one frozen fixture ruleset this slice ships. Every literal word it
// introduces is an industry-standard generic term; the template
// interpolates only the declared placeholder fields.
export const FIXTURE_WORDING_RULESET_V1 = deepFreeze({
  schemaVersion: WORDING_RULESET_SCHEMA_VERSION,
  rulesetId: "fixture-wording-v1",
  rulesetVersion: 1,
  template: "Observed action: {action}. Target control: {targetLabel}.",
  placeholderFields: ["action", "targetLabel"],
  terminologyAllowlist: ["observed", "action", "target", "control"],
});

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateDeclarative(node, ruleset) {
  // The ruleset is data, never behavior: no functions, callbacks, or
  // executable values anywhere in it, and no provider/model/network
  // configuration keys (the W9 gate).
  const stack = [node];
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current === "function") {
      fail("ruleset-not-declarative", "ruleset must be declarative data; function values are not allowed", ruleset);
    }
    if (current && typeof current === "object") {
      for (const key of Object.keys(current)) {
        if (FORBIDDEN_CONFIG_KEY_PATTERN.test(key)) {
          fail(
            "ruleset-forbidden-config",
            `ruleset key "${key.slice(0, 60)}" indicates provider/model/network/executable configuration, which this slice denies`,
            ruleset
          );
        }
        stack.push(current[key]);
      }
    }
  }
}

function validateRuleset(ruleset) {
  if (!isPlainObject(ruleset)) {
    fail("invalid-ruleset", "ruleset must be a plain object", ruleset);
  }
  validateDeclarative(ruleset, ruleset);

  if (Object.prototype.hasOwnProperty.call(ruleset, "operations")) {
    fail(
      "unsupported-operation",
      "ruleset operations (such as append/add-step) are not supported; the pass never invents steps",
      ruleset
    );
  }
  for (const key of Object.keys(ruleset)) {
    if (!ALLOWED_RULESET_KEYS.has(key)) {
      fail("unknown-ruleset-key", `ruleset key "${key.slice(0, 60)}" is not a supported wording rule`, ruleset);
    }
  }

  if (ruleset.schemaVersion !== WORDING_RULESET_SCHEMA_VERSION) {
    fail(
      "unsupported-ruleset-version",
      `unsupported ruleset schemaVersion: ${String(ruleset.schemaVersion).slice(0, 60)}`,
      ruleset
    );
  }
  if (typeof ruleset.rulesetId !== "string" || ruleset.rulesetId.length === 0 || ruleset.rulesetId.length > 200) {
    fail("invalid-ruleset", "ruleset.rulesetId must be a non-empty bounded string", ruleset);
  }
  if (
    (typeof ruleset.rulesetVersion !== "string" && typeof ruleset.rulesetVersion !== "number") ||
    String(ruleset.rulesetVersion).length === 0 ||
    String(ruleset.rulesetVersion).length > 100
  ) {
    fail("invalid-ruleset", "ruleset.rulesetVersion must be a non-empty bounded string or number", ruleset);
  }

  const placeholderFields = ruleset.placeholderFields;
  if (
    !Array.isArray(placeholderFields) ||
    placeholderFields.length === 0 ||
    !placeholderFields.every((f) => typeof f === "string" && FIELD_NAME_PATTERN.test(f) && f.length <= 100)
  ) {
    fail("invalid-ruleset", "ruleset.placeholderFields must be a non-empty array of field names", ruleset);
  }
  // W-002: enforce the supported field set independently of caller
  // declarations — unsupported and duplicate names fail closed here,
  // before validateTemplate and before any output.
  for (const field of placeholderFields) {
    if (!SUPPORTED_PLACEHOLDER_FIELDS.has(field)) {
      fail(
        "unsupported-placeholder-field",
        `placeholder field "${field.slice(0, 60)}" is not a supported source field (supported: action, targetLabel)`,
        ruleset
      );
    }
  }
  if (new Set(placeholderFields).size !== placeholderFields.length) {
    fail("duplicate-placeholder-field", "ruleset.placeholderFields must not repeat a field name", ruleset);
  }

  const allowlist = ruleset.terminologyAllowlist;
  if (
    !Array.isArray(allowlist) ||
    !allowlist.every((w) => typeof w === "string" && w.length > 0 && w.length <= 50)
  ) {
    fail("invalid-ruleset", "ruleset.terminologyAllowlist must be an array of non-empty bounded words", ruleset);
  }

  validateTemplate(ruleset, placeholderFields, allowlist);
}

function validateTemplate(ruleset, placeholderFields, allowlist) {
  const template = ruleset.template;
  if (typeof template !== "string" || template.length === 0 || template.length > MAX_TEMPLATE_LENGTH) {
    fail("malformed-template", "ruleset.template must be a non-empty bounded string", ruleset);
  }

  const placeholders = [...template.matchAll(PLACEHOLDER_PATTERN)].map((m) => m[1]);
  if (placeholders.length === 0) {
    // A template with no step-bound placeholder produces the same
    // output for every step — not bound one-to-one to an input step, so
    // it cannot be wording for that step.
    fail("template-not-one-to-one", "ruleset.template must interpolate at least one declared placeholder field", ruleset);
  }
  for (const name of placeholders) {
    if (!placeholderFields.includes(name)) {
      fail("unknown-placeholder", `template placeholder "{${name.slice(0, 60)}}" is not a declared placeholder field`, ruleset);
    }
  }
  // Anything brace-shaped left over after removing valid placeholders
  // is a malformed template, never silently treated as literal text.
  const withoutPlaceholders = template.replace(PLACEHOLDER_PATTERN, "");
  if (withoutPlaceholders.includes("{") || withoutPlaceholders.includes("}")) {
    fail("malformed-template", "ruleset.template contains unbalanced or malformed braces", ruleset);
  }

  // The template's own literal text is the pass's newly introduced
  // wording: it must make no verification claim, and every normalized
  // word in it must be on the allowlist. Source spans are checked
  // nowhere — they are opaque data, not introduced wording.
  const literalWords = (withoutPlaceholders.toLowerCase().match(WORD_TOKEN_PATTERN) || []);
  for (const word of literalWords) {
    if (VERIFICATION_CLAIM_WORDS.has(word)) {
      fail(
        "verification-claim",
        `ruleset.template literal text must not assert an outcome ("${word.slice(0, 60)}")`,
        ruleset
      );
    }
  }
  const allowed = new Set(allowlist.map((w) => String(w).toLowerCase()));
  for (const word of literalWords) {
    if (!allowed.has(word)) {
      fail(
        "terminology-violation",
        `ruleset.template introduces non-allowlisted wording ("${word.slice(0, 60)}")`,
        ruleset
      );
    }
  }
}

function validateProvenanceTime(provenanceTime, ruleset) {
  if (
    typeof provenanceTime !== "string" ||
    provenanceTime.length === 0 ||
    provenanceTime.length > MAX_PROVENANCE_TIME_LENGTH ||
    !RFC3339_PATTERN.test(provenanceTime)
  ) {
    fail(
      "invalid-provenance-time",
      "provenanceTime must be a required bounded RFC 3339 timestamp string supplied by the caller",
      ruleset
    );
  }
}

function validateGuide(guide, ruleset) {
  if (!isPlainObject(guide)) {
    fail("invalid-guide", "guide must be a plain object", ruleset);
  }
  // Non-fixture input is refused before any wording, with a safe
  // attempt record: code, the supplied source value, and ruleset
  // identity — never guide contents.
  if (guide.source !== "fixture") {
    const supplied = String(guide.source ?? "missing").slice(0, 100);
    throw new WordingError("non-fixture-source", `guide source must be exactly "fixture" (received: ${supplied})`, {
      code: "non-fixture-source",
      source: supplied,
      ...rulesetIdentity(ruleset),
    });
  }
  if (guide.schemaVersion !== GUIDE_SCHEMA_VERSION) {
    fail(
      "unsupported-schema-version",
      `unsupported guide schemaVersion: ${String(guide.schemaVersion).slice(0, 60)}`,
      ruleset
    );
  }
  if (guide.status !== "draft_unverified") {
    fail(
      "unsupported-status",
      `guide status must remain "draft_unverified" (received: ${String(guide.status).slice(0, 60)})`,
      ruleset
    );
  }
  if (!Array.isArray(guide.steps)) {
    fail("invalid-guide", "guide.steps must be an array", ruleset);
  }

  const placeholderFields = ruleset.placeholderFields;
  let previousStepIndex = -1;
  guide.steps.forEach((step, i) => {
    if (!isPlainObject(step)) {
      fail("invalid-guide", `guide.steps[${i}] must be an object`, ruleset);
    }
    if (!Number.isInteger(step.stepIndex) || step.stepIndex < 0 || step.stepIndex <= previousStepIndex) {
      fail(
        "invalid-guide",
        `guide.steps[${i}].stepIndex must be a non-negative integer in ascending order`,
        ruleset
      );
    }
    previousStepIndex = step.stepIndex;
    for (const field of placeholderFields) {
      const value = step[field];
      if (typeof value !== "string" || value.length === 0 || value.length > MAX_SOURCE_SPAN_LENGTH) {
        fail(
          "invalid-guide",
          `guide.steps[${i}].${field} must be a non-empty bounded string (opaque source span)`,
          ruleset
        );
      }
    }
  });
}

// All non-overlapping match intervals of `from` inside `span`
// (indexOf scan, advancing past each match — the same left-to-right
// scan the greedy applicator below performs).
function findMatchIntervals(span, from) {
  const intervals = [];
  let start = 0;
  while (true) {
    const idx = span.indexOf(from, start);
    if (idx === -1) break;
    intervals.push([idx, idx + from.length]);
    start = idx + from.length;
  }
  return intervals;
}

function validateMapping(mapping, guide, ruleset) {
  if (!Array.isArray(mapping)) {
    fail("invalid-mapping", "mapping must be an array of { from, to } entries", ruleset);
  }
  mapping.forEach((entry, i) => {
    if (!isPlainObject(entry)) {
      fail("invalid-mapping", `mapping[${i}] must be an object`, ruleset);
    }
    for (const key of ["from", "to"]) {
      const value = entry[key];
      if (typeof value !== "string" || value.length === 0 || value.length > MAX_MAPPING_ENTRY_LENGTH) {
        fail(
          "invalid-mapping",
          `mapping[${i}].${key} must be a non-empty string of at most ${MAX_MAPPING_ENTRY_LENGTH} characters`,
          ruleset
        );
      }
    }
  });

  const seenFrom = new Map();
  for (const entry of mapping) {
    if (seenFrom.has(entry.from)) {
      fail("invalid-mapping", `duplicate mapping from: "${entry.from.slice(0, 60)}"`, ruleset);
    }
    seenFrom.set(entry.from, entry);
  }

  const placeholderFields = ruleset.placeholderFields;

  // W-003 review fix: rejecting only key containment ("abc" inside
  // "abcdef") missed distinct keys that overlap in a source span without
  // containing each other ("abc"/"cde" inside "abcde"). The greedy single
  // application pass would then silently skip one authorized entry, so
  // ANY overlap between DISTINCT entries' match intervals in the
  // ORIGINAL source spans rejects the whole call before any output is
  // constructed. Same-entry repeated occurrences are deterministic under
  // the greedy left-to-right scan and are not ambiguity.
  for (const step of guide.steps) {
    for (const field of placeholderFields) {
      const span = step[field];
      const hits = [];
      for (const entry of mapping) {
        for (const [start, end] of findMatchIntervals(span, entry.from)) {
          hits.push({ from: entry.from, start, end });
        }
      }
      for (let a = 0; a < hits.length; a++) {
        for (let b = a + 1; b < hits.length; b++) {
          const ha = hits[a];
          const hb = hits[b];
          if (ha.from !== hb.from && ha.start < hb.end && hb.start < ha.end) {
            fail(
              "invalid-mapping",
              `overlapping mapping keys: "${ha.from.slice(0, 40)}" and "${hb.from.slice(0, 40)}"`,
              ruleset
            );
          }
        }
      }
    }
  }

  // Every mapping's `from` must actually occur in the source spans it
  // claims to replace — a mapping to nothing is a caller error, never
  // silently kept.
  for (const entry of mapping) {
    const found = guide.steps.some((step) => placeholderFields.some((field) => step[field].includes(entry.from)));
    if (!found) {
      fail(
        "mapping-source-not-found",
        `mapping from "${entry.from.slice(0, 60)}" matches no source span in any step`,
        ruleset
      );
    }
  }

  // Deterministic precedence, independent of caller array order: longest
  // `from` first, then code-point lexical order. (Overlaps are rejected
  // above, so at most one entry can match at any position regardless.)
  return [...mapping].sort((a, b) => {
    if (b.from.length !== a.from.length) return b.from.length - a.from.length;
    return a.from < b.from ? -1 : a.from > b.from ? 1 : 0;
  });
}

function applyMappingToSpan(span, orderedMapping) {
  if (orderedMapping.length === 0) return { text: span, applied: [] };
  let text = "";
  const applied = [];
  let i = 0;
  while (i < span.length) {
    const hit = orderedMapping.find((entry) => span.startsWith(entry.from, i));
    if (hit) {
      text += hit.to;
      applied.push(hit);
      i += hit.from.length;
    } else {
      text += span[i];
      i++;
    }
  }
  return { text, applied };
}

function renderTemplate(template, spans) {
  return template.replace(PLACEHOLDER_PATTERN, (match, name) => spans[name]);
}

/**
 * Deterministic, fixture-only wording pass. Validates everything before
 * producing anything (all-or-nothing: any violation throws
 * `WordingError` with a stable code and bounded attempt record; no
 * partial guide and no partial diff are ever returned). Never mutates
 * `guide`, `ruleset`, or `mapping`.
 */
export function applyGuideWording({ guide, ruleset, mapping = [], provenanceTime }) {
  validateRuleset(ruleset);
  validateProvenanceTime(provenanceTime, ruleset);
  validateGuide(guide, ruleset);
  const orderedMapping = validateMapping(mapping, guide, ruleset);

  const placeholderFields = ruleset.placeholderFields;
  const template = ruleset.template;

  let guideCopy;
  try {
    guideCopy = structuredClone(guide);
  } catch {
    fail("invalid-guide", "guide could not be copied as plain data", ruleset);
  }

  const diffSteps = [];
  guideCopy.steps = guide.steps.map((sourceStep) => {
    // Opaque source spans: the step's own fields, verbatim. Mapping
    // applies to these spans only — never chained through a prior
    // `wording` field, which is why reapplying the pass is idempotent.
    const sourceSpans = {};
    for (const field of placeholderFields) sourceSpans[field] = sourceStep[field];

    const mappedSpans = {};
    const stepMappings = [];
    for (const field of placeholderFields) {
      const { text, applied } = applyMappingToSpan(sourceSpans[field], orderedMapping);
      mappedSpans[field] = text;
      const byFrom = new Map();
      for (const entry of applied) {
        byFrom.set(entry.from, (byFrom.get(entry.from) || 0) + 1);
      }
      for (const [from, occurrences] of byFrom) {
        const entry = orderedMapping.find((e) => e.from === from);
        stepMappings.push({ stepIndex: sourceStep.stepIndex, field, from, to: entry.to, occurrences });
      }
    }
    // Stable mapping order inside each step entry: field order, then
    // the same deterministic precedence as application.
    stepMappings.sort((a, b) => {
      const fa = placeholderFields.indexOf(a.field) - placeholderFields.indexOf(b.field);
      if (fa !== 0) return fa;
      if (b.from.length !== a.from.length) return b.from.length - a.from.length;
      return a.from < b.from ? -1 : a.from > b.from ? 1 : 0;
    });

    // W-001 review fix: the diff before is the invariant source-wording
    // representation (the same string the UI shows as Before) — never
    // the new template re-rendered onto the source spans. Re-rendering
    // the template here concealed the normalization (before == after
    // with changed=false for every unmapped step); comparing against
    // the invariant baseline records the real template-only phrasing
    // change. Rendered from the step's own source fields only — never
    // from a prior `wording` field — so the baseline survives
    // reapplication (PT6-D2).
    const before = renderSourceWording(sourceSpans);
    const wording = renderTemplate(template, mappedSpans);

    const outStep = structuredClone(sourceStep);
    outStep.wording = wording;
    outStep.wordingPass = {
      schemaVersion: WORDING_RESULT_SCHEMA_VERSION,
      rulesetId: ruleset.rulesetId,
      rulesetVersion: ruleset.rulesetVersion,
      provenanceTime,
    };

    diffSteps.push({
      stepIndex: sourceStep.stepIndex,
      sequenceId: sourceStep.sequenceId ?? null,
      before,
      after: wording,
      changed: before !== wording,
      mappings: stepMappings,
    });

    return outStep;
  });

  const diffReport = {
    schemaVersion: WORDING_RESULT_SCHEMA_VERSION,
    rulesetId: ruleset.rulesetId,
    rulesetVersion: ruleset.rulesetVersion,
    provenanceTime,
    steps: diffSteps,
  };

  return { guide: guideCopy, diffReport };
}
