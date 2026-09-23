// Draft correspondence builder for Call Shield.
//
// buildDraftLetterData() assembles STRUCTURED DATA for a draft letter from a
// case file. It does not render, send, or file anything, and the data always
// carries the mandatory self-help disclosure header verbatim.
//
// Guardrails (from architecture review):
// - The output is "draft correspondence", never an authoritative legal demand.
// - No damages estimates: the letter notes that statutes "may provide for
//   statutory damages depending on the facts and the law" — never a figure.
// - No legal conclusions: the letter states what the user logged (dates,
//   numbers shown, statements made), not what the law deems them.
// - Non-blocking warnings: gaps in the evidence file are listed so the user
//   can fill them before sending; they do not prevent drafting.

import {
  DRAFT_DISCLOSURE_HEADER,
  EVENT_TYPES,
  STATUTE_CITATIONS,
  STATUTORY_DAMAGES_NOTE,
} from "./callShieldConstants.js";
import { scoreReadiness } from "./callShieldReadiness.js";

function generateId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `csl-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Build draft letter data from a case file.
 *
 * @param {object} caseState - from openCase/rebuildCase
 * @param {object} opts
 * @param {string} opts.senderName - user's name
 * @param {string} opts.senderAddress - user's mailing address (multi-line ok)
 * @param {string} opts.recipientName - who the letter is addressed to
 * @param {string} opts.recipientAddress - recipient mailing address
 * @param {number} opts.responseDays - days requested for a response (default 30)
 * @param {string[]} opts.citations - statute citation keys to include; defaults
 *   to TCPA + FCC rules. Use keys of STATUTE_CITATIONS.
 * @returns {{ letter, event }} — letter is the structured draft; event is a
 *   DRAFT_LETTER_GENERATED timeline event for the caller to append.
 */
export function buildDraftLetterData(caseState, opts = {}) {
  if (!caseState || typeof caseState.id !== "string") {
    throw new TypeError("buildDraftLetterData requires a case state");
  }
  for (const field of ["senderName", "senderAddress", "recipientName", "recipientAddress"]) {
    if (!isNonEmptyString(opts[field])) {
      throw new TypeError(`buildDraftLetterData requires opts.${field}`);
    }
  }
  const responseDays = Number.isInteger(opts.responseDays) && opts.responseDays > 0 ? opts.responseDays : 30;
  const citationKeys = Array.isArray(opts.citations) && opts.citations.length > 0
    ? opts.citations
    : ["TCPA", "FCC_RULES"];
  const citations = citationKeys
    .filter((k) => STATUTE_CITATIONS[k])
    .map((k) => STATUTE_CITATIONS[k]);

  const readiness = scoreReadiness(caseState);
  const warnings = [
    ...readiness.gaps.map((g) => g.detail),
    ...readiness.exclusionFactors.map((f) => f.detail),
  ];

  const calls = [...(caseState.calls || [])].sort(
    (a, b) => new Date(a.occurredAt) - new Date(b.occurredAt)
  );
  const optOuts = [...(caseState.optOuts || [])].sort(
    (a, b) => new Date(a.occurredAt) - new Date(b.occurredAt)
  );

  const letterId = generateId();
  const letter = {
    letterId,
    caseId: caseState.id,
    generatedAt: new Date().toISOString(),
    disclosureHeader: DRAFT_DISCLOSURE_HEADER,
    sender: { name: opts.senderName.trim(), address: opts.senderAddress.trim() },
    recipient: { name: opts.recipientName.trim(), address: opts.recipientAddress.trim() },
    subject: `Draft correspondence regarding telemarketing calls attributed to "${caseState.reportedBusinessName}"`,
    body: {
      introduction:
        "I am writing regarding telemarketing calls I have received that I attribute " +
        `to ${caseState.reportedBusinessName}. The details below are drawn from my own ` +
        "records. I am providing this information so that the matter can be reviewed.",
      calls: calls.map((c, i) => ({
        sequence: i + 1,
        occurredAt: c.occurredAt,
        numberShown: c.numberShown,
        direction: c.direction,
        agentName: c.agentName || null,
        businessNameStated: c.businessNameStated || null,
        pitchNotes: c.pitchNotes || null,
      })),
      dncRegistrations: (caseState.dncRegistrations || []).map((r) => ({
        phoneNumber: r.phoneNumber,
        registeredAt: r.registeredAt,
        proofNotes: r.proofNotes || null,
      })),
      optOuts: optOuts.map((o) => ({
        occurredAt: o.occurredAt,
        channel: o.channel,
        notes: o.notes || null,
      })),
      citations,
      damagesNote: STATUTORY_DAMAGES_NOTE,
      request:
        `Please confirm in writing within ${responseDays} days that my number(s) have been ` +
        "placed on your internal do-not-call list and that no further telemarketing calls " +
        "will be placed to them. Please also preserve all records relating to calls to my number(s).",
    },
    warnings,
    readinessStatus: readiness.status,
  };

  const event = {
    id: generateId(),
    type: EVENT_TYPES.DRAFT_LETTER_GENERATED,
    recordedAt: letter.generatedAt,
    payload: { caseId: caseState.id, letterId, recipientName: opts.recipientName.trim() },
  };
  return { letter, event };
}
