// Team Brain P2 — legacy observation parser + intake classification.
//
// Brief §4: "Existing human-readable requests/results are ingested as
// observations, not silently rewritten to the new schema. The importer
// excludes its own receipts/queue projections and matches service
// operation IDs to existing intake events, preventing export→intake
// feedback loops. No scripts, markup or source text execute." Brief §6:
// "Generic observations cannot manufacture AUTHORIZATION or binding
// verdict authority."
//
// This module does pure string/JSON parsing only — no eval, no Function
// constructor, no child_process, no markdown rendering. Content from a
// scanned file is always treated as inert data, regardless of what it
// looks like (even a string that looks like a shell command or a template
// literal is just text here). classifyPath() decides which of three
// buckets a scanned path falls into BEFORE any parsing happens, which is
// what prevents the export→intake feedback loop: the service's own output
// paths are recognized and skipped, never re-ingested as a new inbound
// observation.

const SERVICE_ENVELOPE_PREFIX = "commands/team-brain/";
const SERVICE_RECEIPT_PREFIX = "results/team-brain/receipts/";
const SERVICE_QUEUE_PREFIX = "results/team-brain/queue/";

export const INTAKE_CLASS = {
  SERVICE_OWN_EXPORT: "SERVICE_OWN_EXPORT",
  SIGNED_ENVELOPE_CANDIDATE: "SIGNED_ENVELOPE_CANDIDATE",
  LEGACY_OBSERVATION: "LEGACY_OBSERVATION",
};

// Decides which bucket a scanned path falls into. Pure path-prefix
// matching, no file content involved yet — this is the feedback-loop
// guard: `results/team-brain/receipts/*` and `results/team-brain/queue/*`
// are the service's OWN output and must never be re-ingested as a fresh
// inbound item, no matter what they contain.
export function classifyPath(path) {
  if (path.startsWith(SERVICE_RECEIPT_PREFIX) || path.startsWith(SERVICE_QUEUE_PREFIX)) {
    return INTAKE_CLASS.SERVICE_OWN_EXPORT;
  }
  if (path.startsWith(SERVICE_ENVELOPE_PREFIX) && path.endsWith(".json")) {
    return INTAKE_CLASS.SIGNED_ENVELOPE_CANDIDATE;
  }
  return INTAKE_CLASS.LEGACY_OBSERVATION;
}

// Extracts a `key: value` style header line's value, case-sensitive key,
// first match only, trimmed. Returns null if the line isn't present. Pure
// regex line scan — never interprets the value as anything but a string.
function headerField(text, key) {
  const re = new RegExp(`^${key}\\s*:\\s*(.+)$`, "m");
  const match = text.match(re);
  return match ? match[1].trim() : null;
}

function firstHeading(text) {
  const match = text.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

// Parses a legacy human-readable Markdown file into an inert observation
// record. This NEVER returns anything resembling authority (no "verdict",
// no "authorized", no granted-permission field) - it extracts
// descriptive metadata only. A caller that wants to treat Markdown content
// as a verdict or a grant must do so through the signed-envelope path
// (registry.mjs + verifyAndAuthorize), never through this parser's output.
export function parseLegacyObservation(path, rawText, { introducingCommit, sourceTimestamp } = {}) {
  if (typeof rawText !== "string") {
    throw new TypeError("parseLegacyObservation requires the raw file text as a string");
  }
  return {
    kind: INTAKE_CLASS.LEGACY_OBSERVATION,
    sourcePath: path,
    introducingCommit: introducingCommit ?? null,
    sourceTimestamp: sourceTimestamp ?? null,
    submittedBy: headerField(rawText, "Submitted by"),
    headerDate: headerField(rawText, "Date"),
    processingRef: headerField(rawText, "Processing"),
    title: firstHeading(rawText),
    // The body is kept verbatim, as opaque text, specifically so nothing
    // downstream is tempted to treat it as executable or as a structured
    // authority grant - it is evidence of what was written, nothing more.
    bodyText: rawText,
    isAuthoritative: false,
  };
}

// Parses a candidate signed-envelope JSON file. Only confirms it's valid
// JSON with the fields envelope.mjs/registry.mjs need to attempt
// verification - it does NOT verify the signature or check authorization
// itself (that's registry.verifyAndAuthorize, given the parsed object).
// Malformed JSON is reported as a parse failure, never silently coerced
// into a usable envelope shape.
export function parseEnvelopeCandidate(path, rawText) {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (e) {
    return { kind: INTAKE_CLASS.SIGNED_ENVELOPE_CANDIDATE, sourcePath: path, parseError: String(e.message ?? e), envelope: null };
  }
  return { kind: INTAKE_CLASS.SIGNED_ENVELOPE_CANDIDATE, sourcePath: path, parseError: null, envelope: parsed };
}

// Top-level dispatcher a caller (the intake pipeline) uses for one scanned
// file: classify first, then parse only if it isn't the service's own
// export (which is returned as-is, unparsed, so the caller can simply skip
// it and, when it has operation-id context, match it back to the intake
// event it already recorded for the envelope that produced it).
export function parseScannedFile(path, rawText, context) {
  const cls = classifyPath(path);
  if (cls === INTAKE_CLASS.SERVICE_OWN_EXPORT) {
    return { kind: INTAKE_CLASS.SERVICE_OWN_EXPORT, sourcePath: path, skipped: true };
  }
  if (cls === INTAKE_CLASS.SIGNED_ENVELOPE_CANDIDATE) {
    return parseEnvelopeCandidate(path, rawText);
  }
  return parseLegacyObservation(path, rawText, context);
}

// Matches a service export's operation_id (parsed from a
// SERVICE_OWN_EXPORT path's own filename/content by the caller, since this
// module doesn't parse that content) against the set of operation_ids this
// run already has signed-envelope intake events for. Returns true when the
// export corresponds to something this service itself produced - the
// caller uses that to positively confirm a feedback-loop skip rather than
// skipping purely on path prefix alone.
export function matchesKnownOperation(operationId, knownOperationIds) {
  return knownOperationIds instanceof Set ? knownOperationIds.has(operationId) : knownOperationIds.includes(operationId);
}
