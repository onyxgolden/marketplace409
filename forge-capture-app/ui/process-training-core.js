// FORGE Capture — Process Training PT-1C core (ui/process-training-core.js).
//
// Framework-neutral, DOM-free logic for the consent/session-management
// *shell*: the state machine, the fixture evidence generator, and the
// read-only view-model mapping from the real PT-1B `PipelineMessage`
// shape (core/src/process_capture.rs) to display-ready objects. Runs
// unmodified under vitest (node) and in the Tauri webview; the DOM lives
// in process-training.js.
//
// THIS MODULE NEVER CAPTURES ANYTHING. There is no IPC call anywhere in
// this file to either real backend session command (defined in
// app/src/main.rs), nothing that could ever install the global mouse
// hook. Every piece of "session evidence" this module can produce is
// fixture/demo data from `buildFixtureEvidence`, clearly distinguished
// from anything real. The real pipeline stays dormant regardless of what
// this module does — `SESSIONS_ENABLED` is a Rust-side kill switch
// (`core/src/process_capture.rs`) this module cannot reach, read, or
// influence.
//
// Mirrors the approved PT-1 privacy model exactly (see
// forge-capture-app/docs/process-training-pt1.md) rather than inventing
// a simplified one: there is no automatic "verified safe" status for any
// window. Default trust withholds unconditionally; author-trusted is an
// explicit, disclosed, session-scoped grant for one process that still
// runs every detection signal and still redacts/withholds on a positive
// hit. This module only *displays* that model — it has no power to
// weaken it, since it never touches the real decision logic at all.

// ---------------------------------------------------------------------
// Consent / session state machine
// ---------------------------------------------------------------------

export const PROCESS_TRAINING_STATES = Object.freeze([
  "idle",
  "preflight",
  "consented_preview",
  "review",
  "discarded",
]);

export const TRUST_SCOPES = Object.freeze(["default", "author_trusted"]);

export const CAPTURE_DISABLED_NOTICE =
  "Process Training capture is disabled in this build. Everything below uses fixture/demo data only — no input is being recorded.";

export class ConsentError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConsentError";
  }
}

function normalizeTarget(target) {
  if (!target || !target.label || !target.exeName) {
    throw new ConsentError("a target app/window must be identified first");
  }
  return { label: String(target.label), exeName: String(target.exeName).toLowerCase() };
}

/**
 * The consent/session state machine:
 *   idle -> preflight -> consented_preview -> review -> discarded
 *
 * Every transition is guarded and throws `ConsentError` rather than
 * silently no-opping on an out-of-order call — a UI bug that tries to
 * skip a step (e.g. granting consent before a target is chosen, or
 * reviewing before consent) fails loudly here and in tests, not
 * quietly.
 */
export class ConsentSession {
  constructor() {
    this._reset("idle");
  }

  _reset(state) {
    this.target = null;
    this.trustScope = null;
    this.disclosureAcknowledged = false;
    this.consentedAt = null;
    this.evidence = [];
    this.state = state;
  }

  /** Read-only snapshot, safe to hand to a renderer or a test assertion. */
  describe() {
    return {
      state: this.state,
      target: this.target,
      trustScope: this.trustScope,
      disclosureAcknowledged: this.disclosureAcknowledged,
      consentedAt: this.consentedAt,
      evidenceCount: this.evidence.length,
    };
  }

  /**
   * Chooses (or changes) the target app/window. Legal from ANY state —
   * picking a new target always clears whatever consent/evidence
   * existed for the previous one and returns to `preflight`. This is
   * the mechanism behind "consent resets on target identity change":
   * there is deliberately no way to keep a prior consent grant across a
   * target change.
   */
  beginPreflight(target) {
    const normalized = normalizeTarget(target);
    this._reset("preflight");
    this.target = normalized;
  }

  /**
   * preflight -> consented_preview. Requires an explicit, affirmative
   * choice — the caller (process-training.js) must only invoke this
   * from a real "confirm" button click, never from a dialog close/
   * escape/backdrop-dismiss handler, so consent is never obtained by
   * merely closing a dialog.
   *
   * `trustScope: "author_trusted"` additionally requires
   * `disclosureAcknowledged: true`. This module does not know what the
   * disclosure dialog said (that's a presentation concern), but it
   * refuses to grant trust without the flag being explicitly true —
   * trust can never be silently assumed.
   */
  grantConsent({ trustScope, disclosureAcknowledged = false } = {}) {
    if (this.state !== "preflight") {
      throw new ConsentError(`cannot grant consent from state "${this.state}"`);
    }
    if (!TRUST_SCOPES.includes(trustScope)) {
      throw new ConsentError(`unknown trust scope: ${trustScope}`);
    }
    if (trustScope === "author_trusted" && disclosureAcknowledged !== true) {
      throw new ConsentError(
        "author-trusted scope requires an explicit, acknowledged disclosure"
      );
    }
    this.trustScope = trustScope;
    this.disclosureAcknowledged = trustScope === "author_trusted";
    this.consentedAt = Date.now();
    this.state = "consented_preview";
  }

  /**
   * consented_preview -> review. `evidence` must be a fixture message
   * array (see `buildFixtureEvidence`) — this method does not generate
   * it itself, so the caller's choice of fixture data is explicit and
   * traceable, never implied.
   */
  startReview(evidence) {
    if (this.state !== "consented_preview") {
      throw new ConsentError(`cannot start review from state "${this.state}"`);
    }
    if (!Array.isArray(evidence)) {
      throw new ConsentError("review requires an evidence array, even if empty");
    }
    this.evidence = evidence;
    this.state = "review";
  }

  /**
   * preflight | consented_preview | review -> discarded. Purges target,
   * consent and evidence immediately and irreversibly — nothing about a
   * discarded session is recoverable. There is no "undo discard";
   * `reset()` starts an unrelated new one.
   */
  discard() {
    if (this.state === "idle" || this.state === "discarded") {
      throw new ConsentError(`nothing to discard from state "${this.state}"`);
    }
    this._reset("discarded");
  }

  /**
   * ANY state -> idle. Models app restart / explicit "start another
   * session" — consent never survives this either.
   */
  reset() {
    this._reset("idle");
  }
}

// ---------------------------------------------------------------------
// Fixture evidence
//
// Mirrors core/src/process_capture.rs's real `PipelineMessage` shape
// exactly (read directly from that source, not guessed): the four
// variants (`Event`, `Gap`, `QueueOverflow`, `SessionReconciliationUncertain`),
// `ProcessCaptureEvent`'s fields, `GapMarker`, and the five real
// `QueueOverflow` stage names. A later slice wiring real IPC delivery of
// these messages only needs to swap this generator for a real
// deserialized payload — `toEvidenceViewModel` below should not need to
// change. There is deliberately no IPC call anywhere in this function:
// every message it returns is demo data, and no byte ever resembles a
// real captured pixel (`screenshot` is a small descriptor object, never
// a byte array).
// ---------------------------------------------------------------------

export const QUEUE_OVERFLOW_STAGES = Object.freeze([
  "hook-to-capture",
  "capture-to-evidence",
  "hook-trylock-miss",
  "capture-failure",
  "capture-capacity-exhausted",
]);

export const EVENT_KINDS = Object.freeze(["Click", "DoubleClick", "Drag"]);
export const TRUST_LABELS = Object.freeze(["AuthorTrusted", "Default"]);
export const DECISION_LABELS = Object.freeze(["ProceedNormally", "RedactRegion", "Withhold"]);

function fixtureEvent({ sequenceId, kind, point, target, hasScreenshot, trust, decision }) {
  return {
    type: "Event",
    event: {
      sequenceId,
      hookTimestampMs: sequenceId * 1000,
      captureTimestampMs: sequenceId * 1000 + 15,
      kind,
      point,
      target,
      screenshot: hasScreenshot ? { width: 64, height: 48, fixture: true } : null,
      privacy: { trust, decision },
    },
  };
}

/**
 * Builds a fixture `PipelineMessage` stream demonstrating every real
 * variant and every real privacy outcome, scoped to `trustScope` the
 * way a real session would be — but never actually invoking anything
 * native. Deliberately includes, every time, regardless of
 * `trustScope`:
 *   - a click that only proceeds when author-trusted AND no signal fired
 *   - a click on a sensitive-looking control that redacts/withholds
 *     EVEN when author-trusted, proving trust alone is never enough
 *   - a double-click over an unrecognized/untrusted overlay, withheld
 *     regardless of trust scope
 *   - a drag, to exercise the third `EventKind` variant
 *   - a sequence gap, one `QueueOverflow` for every real stage
 *     (including `capture-capacity-exhausted`), and a
 *     `SessionReconciliationUncertain` — so the review screen always has
 *     something honest-but-incomplete to show, never a clean "all good".
 */
export function buildFixtureEvidence({ trustScope, target } = {}) {
  const exe = target?.exeName || "fixture.exe";
  const trustedHere = trustScope === "author_trusted";
  const trustLabel = trustedHere ? "AuthorTrusted" : "Default";

  const events = [
    fixtureEvent({
      sequenceId: 1,
      kind: "Click",
      point: [120, 240],
      target: { name: "Save", controlTypeId: 50000, automationId: "btn-save", processName: exe },
      hasScreenshot: trustedHere,
      trust: trustLabel,
      decision: trustedHere ? "ProceedNormally" : "Withhold",
    }),
    fixtureEvent({
      sequenceId: 2,
      kind: "Click",
      point: [300, 410],
      target: {
        name: null,
        controlTypeId: 50004,
        automationId: "txt-password",
        processName: exe,
      },
      hasScreenshot: trustedHere,
      trust: trustLabel,
      decision: trustedHere ? "RedactRegion" : "Withhold",
    }),
    fixtureEvent({
      sequenceId: 3,
      kind: "DoubleClick",
      point: [500, 150],
      target: {
        name: null,
        controlTypeId: 0,
        automationId: null,
        processName: "unknown-overlay.exe",
      },
      hasScreenshot: false,
      trust: "Default",
      decision: "Withhold",
    }),
    fixtureEvent({
      sequenceId: 4,
      kind: "Drag",
      point: [80, 80],
      target: { name: "Canvas", controlTypeId: 50033, automationId: "canvas-main", processName: exe },
      hasScreenshot: trustedHere,
      trust: trustLabel,
      decision: trustedHere ? "ProceedNormally" : "Withhold",
    }),
  ];

  const gap = { type: "Gap", gap: { firstMissing: 5, lastMissing: 5 } };

  const lossMessages = QUEUE_OVERFLOW_STAGES.map((stage, i) => ({
    type: "QueueOverflow",
    stage,
    droppedCount: i + 1,
  }));

  const uncertain = { type: "SessionReconciliationUncertain", lastProcessedSeq: 4 };

  return [...events, gap, ...lossMessages, uncertain];
}

// ---------------------------------------------------------------------
// Read-only view-model mapping
// ---------------------------------------------------------------------

/**
 * Maps one real-shaped `PipelineMessage` to a read-only view model.
 * Every real variant gets its own distinct `kind` — there is no
 * catch-all branch that would fold an unrecognized variant into an
 * existing one. An unrecognized `type`, event kind, or privacy label
 * throws rather than being silently dropped, so a future schema change
 * upstream fails a test here instead of quietly vanishing from the
 * review screen.
 */
export function toEvidenceViewModel(message) {
  if (!message || typeof message.type !== "string") {
    throw new ConsentError("pipeline message is missing its type");
  }
  switch (message.type) {
    case "Event": {
      const e = message.event || {};
      if (!EVENT_KINDS.includes(e.kind)) {
        throw new ConsentError(`unknown event kind: ${e.kind}`);
      }
      if (!TRUST_LABELS.includes(e.privacy?.trust) || !DECISION_LABELS.includes(e.privacy?.decision)) {
        throw new ConsentError("event privacy outcome is missing or unrecognized");
      }
      return {
        kind: "event",
        sequenceId: e.sequenceId,
        eventKind: e.kind,
        point: e.point,
        targetLabel: e.target?.name || e.target?.automationId || "(unnamed control)",
        processName: e.target?.processName || "(unknown process)",
        trust: e.privacy.trust,
        decision: e.privacy.decision,
        withheld: e.privacy.decision === "Withhold",
        redacted: e.privacy.decision === "RedactRegion",
        hasScreenshot: Boolean(e.screenshot),
      };
    }
    case "Gap": {
      const g = message.gap || {};
      if (typeof g.firstMissing !== "number" || typeof g.lastMissing !== "number") {
        throw new ConsentError("gap message is missing its range");
      }
      return { kind: "gap", firstMissing: g.firstMissing, lastMissing: g.lastMissing };
    }
    case "QueueOverflow": {
      if (!QUEUE_OVERFLOW_STAGES.includes(message.stage)) {
        throw new ConsentError(`unknown loss stage: ${message.stage}`);
      }
      return { kind: "loss", stage: message.stage, droppedCount: message.droppedCount };
    }
    case "SessionReconciliationUncertain":
      return { kind: "uncertain", lastProcessedSeq: message.lastProcessedSeq ?? null };
    default:
      throw new ConsentError(`unrecognized pipeline message type: ${message.type}`);
  }
}

/**
 * Aggregates a mapped evidence list into the summary the review screen
 * shows. `isComplete` is false whenever ANY sequence gap or
 * reconciliation uncertainty is present — this is the "no success
 * toast, no clean-complete claim" rule: evidence with a hole in it is
 * reported as incomplete, never rounded up to "done". Loss/overflow
 * entries are always reported in `lossByStage` regardless of
 * `isComplete`, for every real stage that appeared — never hidden,
 * never summarized away.
 */
export function summarizeEvidence(viewModels) {
  const summary = {
    totalEvents: 0,
    withheldCount: 0,
    redactedCount: 0,
    proceedCount: 0,
    gapCount: 0,
    lossByStage: {},
    reconciliationUncertain: false,
    lastProcessedSeq: null,
    isComplete: true,
  };
  for (const vm of viewModels || []) {
    switch (vm.kind) {
      case "event":
        summary.totalEvents += 1;
        if (vm.withheld) summary.withheldCount += 1;
        else if (vm.redacted) summary.redactedCount += 1;
        else summary.proceedCount += 1;
        break;
      case "gap":
        summary.gapCount += 1;
        summary.isComplete = false;
        break;
      case "loss":
        summary.lossByStage[vm.stage] = (summary.lossByStage[vm.stage] || 0) + (vm.droppedCount || 0);
        // Review finding: a nonzero drop/overflow count at ANY real
        // stage means something was lost -- marking the summary
        // "complete" just because no separate Gap or
        // SessionReconciliationUncertain happened to also be present
        // would let a session with dropped/failed captures read as
        // clean evidence. A zero-count loss entry (reported but nothing
        // actually dropped yet) does not by itself make a session
        // incomplete.
        if ((vm.droppedCount || 0) > 0) {
          summary.isComplete = false;
        }
        break;
      case "uncertain":
        summary.reconciliationUncertain = true;
        summary.lastProcessedSeq = vm.lastProcessedSeq;
        summary.isComplete = false;
        break;
      default:
        throw new ConsentError(`unrecognized view model kind: ${vm.kind}`);
    }
  }
  return summary;
}
