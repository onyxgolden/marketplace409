// FORGE Capture — Narration mode core (ui/narration-core.js).
//
// Framework-neutral, DOM-free logic for Phase 3 Slice A narration over a
// recorded capture. Runs unmodified under vitest (node) and in the Tauri
// webview; the DOM (tab panel, presenter/consent forms, script table, job
// view, acceptance form, jobs list) lives in narration.js. This module owns:
//   - script validation (timing windows, unique/sorted/non-overlapping steps)
//   - WebVTT caption generation (mirrors the Python runner's caption writer;
//     keep the timestamp format in lockstep)
//   - status labels for consent receipts, voice enrollments, and acceptance
//     receipts
//
// Narration only: no face/avatar anything lives here or in narration.js.
// The Rust backend owns the consent registry, the enrollment store, and
// the job spool; the local runner owns TTS + FFmpeg assembly. Capture
// itself never touches the network and never uploads.

export const NARRATION_POLL_MS = 2000;

// --- timestamps --------------------------------------------------------------

/**
 * Format seconds as HH:MM:SS.mmm. Hours can exceed 24 (a long capture is
 * still one timeline). Pads 2/2/2/3.
 */
export function formatVttTimestamp(sec) {
  const totalMs = Math.max(0, Math.round((Number(sec) || 0) * 1000));
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);
  const pad = (n, w) => String(n).padStart(w, "0");
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}.${pad(ms, 3)}`;
}

/** Human display for a duration: "M:SS.s" (e.g. 65.5 -> "1:05.5"). */
export function formatSec(sec) {
  const totalTenths = Math.max(0, Math.round((Number(sec) || 0) * 10));
  const m = Math.floor(totalTenths / 600);
  const s = Math.floor((totalTenths % 600) / 10);
  const tenth = totalTenths % 10;
  return `${m}:${String(s).padStart(2, "0")}.${tenth}`;
}

// --- script validation --------------------------------------------------------

/**
 * Validate narration script segments against a capture of
 * `captureDurationSec` seconds. Returns an array of error strings; empty
 * means the script is valid. Every error names the offending stepId (or
 * the segment index when there is no stepId to name).
 *
 * Rules:
 * - segments is a non-empty array
 * - each segment has a non-empty stepId and non-empty text (trimmed)
 * - captureStartSec >= 0
 * - captureEndSec > captureStartSec
 * - captureEndSec <= captureDurationSec
 * - stepIds unique
 * - segments sorted by captureStartSec with no overlaps
 *   (each start >= previous end)
 *
 * Segments carry { stepId, text, captureStartSec, captureEndSec }.
 */
export function validateScriptSegments(segments, captureDurationSec) {
  const errors = [];
  if (!Array.isArray(segments) || segments.length === 0) {
    errors.push("Script must contain at least one segment.");
    return errors;
  }
  const duration = Number(captureDurationSec);
  if (!Number.isFinite(duration) || duration < 0) {
    errors.push("Capture duration must be a non-negative number of seconds.");
  }

  const seenIds = new Set();
  let prev = null; // previous segment, in listed order
  segments.forEach((seg, i) => {
    const rawId = seg && typeof seg.stepId === "string" ? seg.stepId.trim() : "";
    // Name the segment by its stepId when it has one, else by index.
    const name = rawId ? `Step "${rawId}"` : `Segment at index ${i}`;
    const stepId = rawId;

    if (!stepId) {
      errors.push(`${name}: stepId must not be empty.`);
    } else if (seenIds.has(stepId)) {
      errors.push(`${name}: stepId is duplicated — step ids must be unique.`);
    } else {
      seenIds.add(stepId);
    }

    const text = seg && typeof seg.text === "string" ? seg.text.trim() : "";
    if (!text) {
      errors.push(`${name}: text must not be empty.`);
    }

    const start = Number(seg && seg.captureStartSec);
    const end = Number(seg && seg.captureEndSec);
    if (!Number.isFinite(start)) {
      errors.push(`${name}: captureStartSec must be a number.`);
    } else if (start < 0) {
      errors.push(`${name}: captureStartSec (${start}) must be >= 0.`);
    }
    if (!Number.isFinite(end)) {
      errors.push(`${name}: captureEndSec must be a number.`);
    } else {
      if (Number.isFinite(start) && end <= start) {
        errors.push(`${name}: captureEndSec (${end}) must be greater than captureStartSec (${start}).`);
      }
      if (Number.isFinite(duration) && end > duration) {
        errors.push(`${name}: captureEndSec (${end}) exceeds the capture duration (${duration}s).`);
      }
    }

    // Ordering + overlap, in listed order: each segment must start at or
    // after the previous segment's start (sorted) and at or after the
    // previous segment's end (no overlap).
    if (prev) {
      const prevStart = Number(prev.captureStartSec);
      const prevEnd = Number(prev.captureEndSec);
      const prevName =
        prev && typeof prev.stepId === "string" && prev.stepId.trim()
          ? `step "${prev.stepId.trim()}"`
          : "the previous segment";
      if (Number.isFinite(start) && Number.isFinite(prevStart) && start < prevStart) {
        errors.push(`${name}: segments must be sorted by captureStartSec — it starts before ${prevName}.`);
      }
      if (Number.isFinite(start) && Number.isFinite(prevEnd) && start < prevEnd) {
        errors.push(`${name}: overlaps ${prevName} — it starts (${start}s) before the previous segment ends (${prevEnd}s).`);
      }
    }
    prev = seg;
  });
  return errors;
}

/** True when two { start, end } windows overlap (touching is not overlap). */
export function segmentsOverlap(a, b) {
  return a.start < b.end && b.start < a.end;
}

// --- captions -----------------------------------------------------------------

/**
 * Build a WebVTT document from script segments: "WEBVTT\n\n" then one cue
 * per segment, "HH:MM:SS.mmm --> HH:MM:SS.mmm\n<text>\n\n", text verbatim.
 * Segments carry { captureStartSec, captureEndSec, text }.
 */
export function buildVtt(segments) {
  const cues = (segments || []).map((seg) => {
    const start = formatVttTimestamp(seg.captureStartSec);
    const end = formatVttTimestamp(seg.captureEndSec);
    return `${start} --> ${end}\n${String(seg.text)}\n`;
  });
  return `WEBVTT\n\n${cues.map((c) => `${c}\n`).join("")}`;
}

// --- status labels --------------------------------------------------------------

/**
 * Consent receipt label. Receipt shape (ConsentReceipt):
 * { status: "active" | "revoked", scope: ["voice", ...], ... }
 */
export function consentStatusLabel(receipt) {
  if (!receipt) return "No receipt";
  if (receipt.status === "revoked") return "Revoked";
  const scope = Array.isArray(receipt.scope) ? receipt.scope : [];
  if (!scope.includes("voice")) return "Voice scope missing";
  return "Active";
}

/**
 * Voice enrollment label. Enrollment shape (VoiceEnrollment):
 * { status: "pending" | "active" | "revoked", ... }
 */
export function enrollmentStatusLabel(enrollment) {
  if (!enrollment) return "Not enrolled";
  if (enrollment.status === "pending") return "Pending";
  if (enrollment.status === "active") return "Active";
  if (enrollment.status === "revoked") return "Revoked";
  return "Not enrolled";
}

/**
 * Acceptance verdict label, computed from the returned receipt — never
 * assumed. Receipt shape (AcceptanceReceipt):
 * { presenter_decision, reviewer_decision, verdict, ... }
 * "PASS" only when presenter and reviewer both approved, else "FAIL".
 */
export function acceptanceVerdictLabel(receipt) {
  if (!receipt) return "Not reviewed";
  return receipt.presenter_decision === "approved" && receipt.reviewer_decision === "approved"
    ? "PASS"
    : "FAIL";
}
