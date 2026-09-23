// Pure case aggregate for Call Shield.
//
// A case is an append-only event timeline. Every mutation returns a new case
// state plus the event that was recorded; nothing here ever rewrites history.
// The domain stores what the user observed and asserted — reported business
// names, numbers shown, what was said — and never stores legal conclusions
// (no "violation confirmed", no "claim valid", no damages figures).

import { EVENT_TYPES, OPT_OUT_CHANNELS } from "./callShieldConstants.js";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  return !Number.isNaN(d.getTime());
}

function toIsoDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString();
}

function generateId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `cs-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

function baseEvent(type, payload) {
  return {
    id: generateId(),
    type,
    recordedAt: new Date().toISOString(),
    payload,
  };
}

/**
 * Open a new case. reportedBusinessName is the user's assertion about who
 * appears responsible — recorded as reported, not adjudicated.
 */
export function openCase({ reportedBusinessName, notes = "", ownerId = null } = {}) {
  if (!isNonEmptyString(reportedBusinessName)) {
    throw new TypeError("openCase requires a reportedBusinessName");
  }
  const caseId = generateId();
  const event = baseEvent(EVENT_TYPES.CASE_OPENED, {
    caseId,
    ownerId,
    reportedBusinessName: reportedBusinessName.trim(),
    notes: typeof notes === "string" ? notes : "",
  });
  return {
    state: applyEvents([], [event]),
    event,
  };
}

/**
 * Log one call. numberShown is the caller ID as displayed (may be spoofed —
 * recorded as shown, not as verified). occurredAt defaults to now.
 */
export function logCall(caseState, {
  numberShown,
  occurredAt = new Date(),
  direction = "incoming",
  pitchNotes = "",
  agentName = "",
  businessNameStated = "",
} = {}) {
  assertCaseState(caseState);
  if (!isNonEmptyString(numberShown)) {
    throw new TypeError("logCall requires a numberShown");
  }
  if (!isValidDate(occurredAt)) {
    throw new TypeError("logCall requires a valid occurredAt");
  }
  if (direction !== "incoming" && direction !== "outgoing") {
    throw new TypeError('logCall direction must be "incoming" or "outgoing"');
  }
  const event = baseEvent(EVENT_TYPES.CALL_LOGGED, {
    caseId: caseState.id,
    callId: generateId(),
    numberShown: numberShown.trim(),
    occurredAt: toIsoDate(occurredAt),
    direction,
    pitchNotes: typeof pitchNotes === "string" ? pitchNotes : "",
    agentName: typeof agentName === "string" ? agentName.trim() : "",
    // What the caller claimed to represent — a user assertion, not a finding.
    businessNameStated: typeof businessNameStated === "string" ? businessNameStated.trim() : "",
  });
  return { state: applyEvents(caseState.events, [event]), event };
}

/**
 * Record an opt-out / revocation. channel is how the user revoked permission
 * (verbal statement on a call, written message, other). The domain records
 * the user's assertion that they revoked; it does not decide legal effect.
 */
export function recordOptOut(caseState, { channel, occurredAt = new Date(), notes = "" } = {}) {
  assertCaseState(caseState);
  const validChannels = Object.values(OPT_OUT_CHANNELS);
  if (!validChannels.includes(channel)) {
    throw new TypeError(`recordOptOut channel must be one of: ${validChannels.join(", ")}`);
  }
  if (!isValidDate(occurredAt)) {
    throw new TypeError("recordOptOut requires a valid occurredAt");
  }
  const event = baseEvent(EVENT_TYPES.OPT_OUT_RECORDED, {
    caseId: caseState.id,
    optOutId: generateId(),
    channel,
    occurredAt: toIsoDate(occurredAt),
    notes: typeof notes === "string" ? notes : "",
  });
  return { state: applyEvents(caseState.events, [event]), event };
}

/**
 * Record a Do-Not-Call registration for a protected number. registeredAt is
 * the registration timestamp as shown by the registry (user-entered).
 */
export function recordDncRegistration(caseState, { phoneNumber, registeredAt, proofNotes = "" } = {}) {
  assertCaseState(caseState);
  if (!isNonEmptyString(phoneNumber)) {
    throw new TypeError("recordDncRegistration requires a phoneNumber");
  }
  if (!isValidDate(registeredAt)) {
    throw new TypeError("recordDncRegistration requires a valid registeredAt");
  }
  const event = baseEvent(EVENT_TYPES.DNC_REGISTRATION_RECORDED, {
    caseId: caseState.id,
    registrationId: generateId(),
    phoneNumber: phoneNumber.trim(),
    registeredAt: toIsoDate(registeredAt),
    proofNotes: typeof proofNotes === "string" ? proofNotes : "",
  });
  return { state: applyEvents(caseState.events, [event]), event };
}

/**
 * Record the user's acknowledgment of recording-law notice before a call
 * recording is captured. Stored with the event; the user remains responsible
 * for confirming recording is permitted where they are.
 */
export function acknowledgeRecordingNotice(caseState, { occurredAt = new Date() } = {}) {
  assertCaseState(caseState);
  if (!isValidDate(occurredAt)) {
    throw new TypeError("acknowledgeRecordingNotice requires a valid occurredAt");
  }
  const event = baseEvent(EVENT_TYPES.RECORDING_CONSENT_ACKNOWLEDGED, {
    caseId: caseState.id,
    occurredAt: toIsoDate(occurredAt),
    notice:
      "I understand call-recording laws vary by location and I am responsible " +
      "for confirming recording is permitted before I record.",
  });
  return { state: applyEvents(caseState.events, [event]), event };
}

/**
 * Fold an event list into case state. Pure: the same events always produce
 * the same state. Exported so persistence can rebuild state from storage.
 */
export function applyEvents(existingEvents, newEvents) {
  const events = [...(existingEvents || []), ...(newEvents || [])];
  const state = {
    id: null,
    ownerId: null,
    reportedBusinessName: "",
    notes: "",
    openedAt: null,
    calls: [],
    evidence: [],
    optOuts: [],
    dncRegistrations: [],
    recordingNoticeAcknowledgedAt: null,
    draftLetters: [],
    exports: [],
    events,
  };
  for (const event of events) {
    reduceEvent(state, event);
  }
  return state;
}

/** Rebuild case state from a stored event list. */
export function rebuildCase(events) {
  return applyEvents([], events || []);
}

function reduceEvent(state, event) {
  const p = event.payload || {};
  switch (event.type) {
    case EVENT_TYPES.CASE_OPENED:
      state.id = p.caseId;
      state.ownerId = p.ownerId ?? null;
      state.reportedBusinessName = p.reportedBusinessName || "";
      state.notes = p.notes || "";
      state.openedAt = event.recordedAt;
      break;
    case EVENT_TYPES.CALL_LOGGED:
      state.calls.push({
        callId: p.callId,
        numberShown: p.numberShown,
        occurredAt: p.occurredAt,
        direction: p.direction,
        pitchNotes: p.pitchNotes,
        agentName: p.agentName,
        businessNameStated: p.businessNameStated,
      });
      break;
    case EVENT_TYPES.EVIDENCE_ATTACHED:
      state.evidence.push({
        evidenceId: p.evidenceId,
        callId: p.callId || null,
        kind: p.kind,
        fileName: p.fileName,
        mimeType: p.mimeType,
        byteSize: p.byteSize,
        sha256: p.sha256,
        capturedAt: p.capturedAt,
        recordedAt: event.recordedAt,
      });
      break;
    case EVENT_TYPES.OPT_OUT_RECORDED:
      state.optOuts.push({
        optOutId: p.optOutId,
        channel: p.channel,
        occurredAt: p.occurredAt,
        notes: p.notes,
      });
      break;
    case EVENT_TYPES.DNC_REGISTRATION_RECORDED:
      state.dncRegistrations.push({
        registrationId: p.registrationId,
        phoneNumber: p.phoneNumber,
        registeredAt: p.registeredAt,
        proofNotes: p.proofNotes,
      });
      break;
    case EVENT_TYPES.RECORDING_CONSENT_ACKNOWLEDGED:
      state.recordingNoticeAcknowledgedAt = p.occurredAt;
      break;
    case EVENT_TYPES.DRAFT_LETTER_GENERATED:
      state.draftLetters.push({
        letterId: p.letterId,
        generatedAt: event.recordedAt,
        recipientName: p.recipientName,
      });
      break;
    case EVENT_TYPES.EXPORT_CREATED:
      state.exports.push({
        exportId: p.exportId,
        generatedAt: event.recordedAt,
        manifestHash: p.manifestHash,
        itemCount: p.itemCount,
      });
      break;
    default:
      break;
  }
}

function assertCaseState(caseState) {
  if (!caseState || !isNonEmptyString(caseState.id) || !Array.isArray(caseState.events)) {
    throw new TypeError("expected a case state created by openCase/rebuildCase");
  }
}
