// Shared constants for the Call Shield domain (TCPA / Do-Not-Call evidence).
//
// Naming rule for this module: the domain records OBSERVATIONS and USER
// ASSERTIONS, never legal conclusions. Nothing here decides whether a
// violation occurred, whether a claim is valid, or what anyone is owed —
// those are questions for the user and their attorney. The domain tracks
// evidence completeness and surfaces readiness signals.

/** Immutable event types appended to a case's event timeline. */
export const EVENT_TYPES = Object.freeze({
  CASE_OPENED: "CASE_OPENED",
  CALL_LOGGED: "CALL_LOGGED",
  EVIDENCE_ATTACHED: "EVIDENCE_ATTACHED",
  OPT_OUT_RECORDED: "OPT_OUT_RECORDED",
  DNC_REGISTRATION_RECORDED: "DNC_REGISTRATION_RECORDED",
  RECORDING_CONSENT_ACKNOWLEDGED: "RECORDING_CONSENT_ACKNOWLEDGED",
  DRAFT_LETTER_GENERATED: "DRAFT_LETTER_GENERATED",
  EXPORT_CREATED: "EXPORT_CREATED",
});

/**
 * Readiness signal types. A signal is an observed fact about the evidence
 * on file — e.g. a DNC registration timestamp exists — not a legal finding.
 */
export const SIGNAL_TYPES = Object.freeze({
  DNC_REGISTRATION_PRESENT: "DNC_REGISTRATION_PRESENT",
  CALLS_AFTER_DNC_WINDOW: "CALLS_AFTER_DNC_WINDOW",
  REPEATED_CALLS_SAME_ENTITY: "REPEATED_CALLS_SAME_ENTITY",
  OPT_OUT_DOCUMENTED: "OPT_OUT_DOCUMENTED",
  IDENTITY_EVIDENCE_PRESENT: "IDENTITY_EVIDENCE_PRESENT",
  POTENTIAL_EXCLUSION_FACTOR: "POTENTIAL_EXCLUSION_FACTOR",
  EVIDENCE_GAP: "EVIDENCE_GAP",
});

/** Readiness statuses. "flagged" means needs human/attorney review, never "disqualified". */
export const READINESS_STATUS = Object.freeze({
  READY: "ready", // green: evidence patterns attorneys may review
  INCOMPLETE: "incomplete", // yellow: gaps the user can still fill
  FLAGGED: "flagged", // red: potential exclusion factor identified — needs review
});

/** Opt-out channels the domain recognizes. */
export const OPT_OUT_CHANNELS = Object.freeze({
  VERBAL_ON_CALL: "verbal_on_call",
  WRITTEN: "written",
  OTHER: "other",
});

/** Evidence kinds accepted by attachEvidence. */
export const EVIDENCE_KINDS = Object.freeze({
  AUDIO_RECORDING: "audio_recording",
  CALL_LOG_SCREENSHOT: "call_log_screenshot",
  VOICEMAIL: "voicemail",
  TEXT_MESSAGE: "text_message",
  DOCUMENT: "document",
  OTHER: "other",
});

/** MIME types accepted for evidence attachments. */
export const ALLOWED_EVIDENCE_MIME_TYPES = Object.freeze([
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/x-wav",
  "audio/aac",
  "audio/ogg",
  "audio/webm",
  "audio/amr",
  "audio/3gpp",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
  "text/plain",
]);

/**
 * Mandatory disclosure header. Every generated draft document must include
 * this text verbatim at the top. It is the product's UPL / deceptive-marketing
 * guardrail: the app is a self-help evidence tool, not a lawyer.
 */
export const DRAFT_DISCLOSURE_HEADER = Object.freeze(
  "DRAFT FOR USER REVIEW — This document was generated from information entered " +
    "by the user in Call Shield, a self-help evidence organization tool. It is not " +
    "legal advice, does not create an attorney-client relationship, and does not " +
    "determine whether a violation occurred or what any person or business may owe. " +
    "The user should verify all facts, review applicable law, and consult a licensed " +
    "attorney before sending or relying on this document."
);

/**
 * Statute citations referenced by draft letters. These are factual references
 * to public law, not legal advice about how they apply to the user's facts.
 */
export const STATUTE_CITATIONS = Object.freeze({
  TCPA: "Telephone Consumer Protection Act, 47 U.S.C. § 227",
  FCC_RULES: "FCC implementing rules, 47 CFR § 64.1200",
  FLORIDA_MINI_TCPA: "Florida Telemarketing Act / Florida mini-TCPA, Fla. Stat. § 501.059",
});

/** Plain-language note used wherever statutory damages are mentioned. Never a recovery estimate. */
export const STATUTORY_DAMAGES_NOTE = Object.freeze(
  "Applicable statutes may provide for statutory damages depending on the facts " +
    "and the law. This tool does not estimate any amount the user may recover."
);

/** Federal DNC rule-of-thumb thresholds used as evidence signals (not legal tests). */
export const DNC_REGISTRATION_WINDOW_DAYS = 31;
export const REPEAT_CALL_WINDOW_MONTHS = 12;
export const REPEAT_CALL_THRESHOLD = 2;
