// FORGE Capture — Process Training PT-2 guide compiler
// (ui/process-guide-compiler.js).
//
// Pure, deterministic, host-independent compiler: turns a finalized,
// fixture-shaped array of PT-1C `PipelineMessage` evidence (see
// process-training-core.js's `toEvidenceViewModel`/`summarizeEvidence`,
// which this module reuses rather than duplicating a second incompatible
// pipeline schema) into a draft guide artifact. No DOM, no Tauri, no
// filesystem, no network, no AI calls — see the structural test in
// `__tests__/process-guide-compiler.test.js` that scans this file's own
// source for exactly those things and fails if any appear.
//
// THIS MODULE NEVER CAPTURES OR PERSISTS ANYTHING. It accepts only
// already-finalized, already-reviewed fixture evidence (the same
// `session.evidence` PT-1C's review screen already shows) and returns an
// in-memory JSON-serializable object — nothing is written to disk,
// nothing is sent anywhere, nothing is exported. A real/live session
// input is out of scope for this slice; the real pipeline stays entirely
// unreachable from here (there is no code path in this file that could
// ever reach `SESSIONS_ENABLED`, the hook, or either real session
// command, because this module never calls out to anything at all).
//
// Privacy stance: the compiler doesn't make its own privacy decisions —
// it displays, verbatim, the decisions PT-1B's real design already made
// (trust/decision on each `Event`). A withheld or redacted step never
// shows the real control name/automation id (those can be identifying),
// and the fixture screenshot descriptor it might carry is never an
// actual image and never referenced as one — only `hasScreenshot:
// boolean` passes through, exactly as `toEvidenceViewModel` already
// exposes it.
//
// Ordering: `sequenceId` is this codebase's one authoritative ordering
// signal (see `RawHookEvent`'s own doc comment in
// `core/src/process_capture.rs` — it is assigned once, at hook time, and
// is authoritative for ordering everywhere downstream). This compiler
// sorts strictly by `sequenceId`; it never falls back to input-array
// order or timestamp as a disguised substitute order. If `sequenceId`
// itself cannot disambiguate order — missing, non-integer, negative, or
// duplicated across two events — compilation fails closed
// (`GuideCompileError`) rather than inventing a plausible-looking order
// and presenting it as real evidence. A `Gap` message is NOT this kind
// of failure; it's normal, already-honest evidence from the real
// pipeline and becomes a guide-level (and, where the surrounding
// sequence ids are actually present, step-adjacent) warning instead.

import { toEvidenceViewModel, summarizeEvidence } from "./process-training-core.js";

export const GUIDE_SCHEMA_VERSION = 1;

export class GuideCompileError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GuideCompileError";
    this.code = code;
  }
}

const OBSERVED_ACTION_BY_KIND = Object.freeze({
  Click: "Click observed",
  DoubleClick: "Double-click observed",
  Drag: "Drag observed",
});

function describeObservedAction(eventKind) {
  const label = OBSERVED_ACTION_BY_KIND[eventKind];
  if (!label) {
    // toEvidenceViewModel already validates eventKind against
    // EVENT_KINDS before this module ever sees it, so reaching here
    // means a kind was added there without being taught here too --
    // fail closed rather than silently describing it as something it
    // might not be.
    throw new GuideCompileError("invalid-evidence", `unknown event kind: ${eventKind}`);
  }
  // Deliberately describes only what the hook observed, never an
  // inferred intent, outcome, success, or completion -- a click is
  // "observed", not "the user saved the file".
  return label;
}

function compileStep(vm, stepIndex) {
  const sensitive = vm.decision !== "ProceedNormally";
  return {
    stepIndex,
    sequenceId: vm.sequenceId,
    action: describeObservedAction(vm.eventKind),
    point: vm.point,
    processName: vm.processName,
    // Withheld/RedactRegion steps never carry the real control name or
    // automation id into the guide -- those can be identifying even
    // when the pixels themselves are withheld/redacted. A generic label
    // is the only "safe metadata" kept for those steps' target.
    targetLabel: sensitive ? "(withheld — sensitive content)" : vm.targetLabel,
    trust: vm.trust,
    decision: vm.decision,
    withheld: vm.withheld,
    redacted: vm.redacted,
    // Never the pixels themselves, and never a URL/reference that could
    // resolve to them -- just whether one exists, exactly as
    // toEvidenceViewModel already exposed it.
    hasScreenshot: vm.hasScreenshot,
    evidenceRef: { sequenceId: vm.sequenceId },
  };
}

function compileWarning(vm) {
  switch (vm.kind) {
    case "gap":
      return {
        type: "gap",
        firstMissing: vm.firstMissing,
        lastMissing: vm.lastMissing,
        stepIndexHint: null,
      };
    case "loss":
      return { type: "loss", stage: vm.stage, droppedCount: vm.droppedCount };
    case "uncertain":
      return { type: "uncertain", lastProcessedSeq: vm.lastProcessedSeq };
    default:
      // toEvidenceViewModel only ever produces "event" | "gap" | "loss" |
      // "uncertain"; "event" is filtered out before this is called.
      // Reaching here means a new kind was added there without being
      // taught here too -- fail closed, don't silently drop it from the
      // guide's warnings.
      throw new GuideCompileError("invalid-evidence", `unrecognized warning kind: ${vm.kind}`);
  }
}

/**
 * Attaches a step-adjacent position hint to a `gap` warning only when the
 * evidence actually places it: when a step exists at exactly
 * `firstMissing - 1`, its index is recorded so a preview can show the
 * warning right after that step. When no such step is present, the hint
 * stays `null` and the warning remains guide-level only -- never a
 * guessed position.
 */
function attachGapPositionHints(warnings, sortedEvents) {
  for (const w of warnings) {
    if (w.type !== "gap") continue;
    const match = sortedEvents.findIndex((vm) => vm.sequenceId === w.firstMissing - 1);
    w.stepIndexHint = match === -1 ? null : match;
  }
}

/**
 * Compiles a finalized fixture evidence array (the same shape PT-1C's
 * `session.evidence` already holds, as real-shaped `PipelineMessage`
 * objects) into a draft guide artifact. Pure: no side effects, does not
 * mutate `evidence` or any object inside it, and calling this twice on
 * the same input produces deep-equal (not reference-equal) output.
 *
 * `meta.target`/`meta.trustScope` are the PT-1C session's own consent
 * descriptors (`ConsentSession.target`/`.trustScope`) — carried through
 * so the guide records what consent scope produced it, never inferred
 * from the evidence itself.
 *
 * Throws `GuideCompileError` (never returns a partial/best-guess guide)
 * when:
 * - `evidence` is not an array.
 * - any contained message fails `toEvidenceViewModel`'s own validation
 *   (unrecognized variant/kind/label — same fail-closed behavior PT-1C's
 *   review screen already relies on).
 * - an `Event`'s `sequenceId` is missing, non-integer, or negative.
 * - two `Event`s share the same `sequenceId` (ambiguous order).
 */
export function compileGuide(evidence, meta = {}) {
  if (!Array.isArray(evidence)) {
    throw new GuideCompileError("invalid-evidence", "evidence must be an array");
  }

  const viewModels = evidence.map(toEvidenceViewModel);

  const eventVMs = [];
  const warningVMs = [];
  for (const vm of viewModels) {
    if (vm.kind === "event") eventVMs.push(vm);
    else warningVMs.push(vm);
  }

  const seenSeq = new Set();
  for (const vm of eventVMs) {
    const seq = vm.sequenceId;
    if (!Number.isInteger(seq) || seq < 0) {
      throw new GuideCompileError(
        "sequence-integrity",
        `event has a missing or invalid sequenceId: ${String(seq)}`
      );
    }
    if (seenSeq.has(seq)) {
      throw new GuideCompileError(
        "sequence-integrity",
        `duplicate sequenceId ${seq} -- cannot determine a reliable order`
      );
    }
    seenSeq.add(seq);
  }

  // The one authoritative order, regardless of the input array's own
  // order -- never the input order itself, never a timestamp fallback.
  const sortedEvents = [...eventVMs].sort((a, b) => a.sequenceId - b.sequenceId);

  const steps = sortedEvents.map((vm, index) => compileStep(vm, index));
  const warnings = warningVMs.map(compileWarning);
  attachGapPositionHints(warnings, sortedEvents);

  const target = meta.target ? { label: meta.target.label, exeName: meta.target.exeName } : null;

  return {
    schemaVersion: GUIDE_SCHEMA_VERSION,
    source: "fixture",
    status: "draft_unverified",
    target,
    trustScope: meta.trustScope ?? null,
    steps,
    warnings,
    // Reuses the same completeness accounting the review screen already
    // shows (never a second, possibly-inconsistent notion of
    // "complete") -- isComplete is false whenever any gap, nonzero
    // loss, or reconciliation uncertainty is present, exactly as
    // summarizeEvidence already defines it.
    completeness: summarizeEvidence(viewModels),
  };
}
