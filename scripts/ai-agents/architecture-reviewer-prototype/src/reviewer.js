/**
 * reviewer.js — evidence-linked synthetic design checklist evaluator for
 * the architecture-reviewer prototype.
 *
 * Design facts are parsed from registered structured fixture text with
 * exact byte spans; there is no arbitrary architectural inference. A
 * missing required clause is evidenced by complete bounded document
 * coverage, never fabricated quotes. Findings carry stable IDs derived
 * from check/source identity, and both conflicting clauses of a
 * contradiction are preserved — never averaged.
 */

import { CHECK_IDS, CHECK_DEFS, evaluateCheck, detectContradictions } from "./checks.js";
import { stableFindingId, stableReviewId, canonicalJson } from "./canonical.js";

export class ReviewerError extends Error {
  constructor(code, status, reason) {
    super(reason);
    this.name = "ReviewerError";
    this.code = code;
    this.status = status;
  }
}

const CLAUSE_RE = /^\s*\[check:([a-z0-9-]+)\]\s*(.*)$/;
const FIELD_RE = /^\s*([a-zA-Z0-9_]+)\s*:\s*(.*?)\s*$/;
const normValue = (v) => String(v).trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Parse clause fields: `key: value; key2: value2`.
 *
 * Runtime grammar validation for the bounded clause schema (AR-002):
 * - duplicate keys are PRESERVED (never last-wins repair): all
 *   occurrences are recorded so contradictions classify them;
 * - fragments that do not match `key: value` are recorded as malformed
 *   instead of being silently dropped.
 */
function parseFields(rest) {
  const fields = {};
  const duplicates = [];
  const malformed = [];
  for (const part of rest.split(";")) {
    if (part.trim() === "") continue;
    const m = part.match(FIELD_RE);
    if (!m) {
      malformed.push(part.trim());
      continue;
    }
    const key = m[1];
    const value = m[2];
    if (key in fields) {
      const dup = duplicates.find((d) => d.key === key);
      if (dup) dup.values.push(value);
      else duplicates.push({ key, values: [fields[key], value] });
    } else {
      fields[key] = value;
    }
  }
  return { fields, duplicates, malformed };
}

/**
 * Extract clauses from design text with exact UTF-8 byte spans.
 * Returns [{check_id, fields, duplicates, malformed, unknownFields,
 * text, start_byte, end_byte}]. Each clause span extraction is charged
 * to the budget (AR-004).
 */
export function extractClauses(text, budget) {
  const clauses = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    const lineBytes = Buffer.byteLength(line, "utf8");
    const m = line.match(CLAUSE_RE);
    if (m && CHECK_DEFS[m[1]]) {
      const { fields, duplicates, malformed } = parseFields(m[2]);
      const unknownFields = Object.keys(fields).filter((k) => !CHECK_DEFS[m[1]].controlFields.includes(k));
      clauses.push({
        check_id: m[1],
        fields,
        duplicates,
        malformed,
        unknownFields,
        text: line,
        start_byte: offset,
        end_byte: offset + lineBytes,
      });
      if (budget) budget.countSpan();
    }
    offset += lineBytes + 1;
  }
  return clauses;
}

/** Deduplicate identical clauses (same check + same canonical fields). */
export function dedupeClauses(clauses) {
  const seen = new Set();
  const out = [];
  for (const c of clauses) {
    const key = `${c.check_id}\0${JSON.stringify(Object.entries(c.fields).sort())}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(c);
    }
  }
  return out;
}

function clauseCitation(designRef, clause) {
  return {
    repo: designRef.repo,
    path: designRef.path,
    commit: designRef.commit,
    blob: designRef.blob,
    algorithm: "git-sha1",
    revision: designRef.revision,
    quoted_span: clause.text,
    span: { start_byte: clause.start_byte, end_byte: clause.end_byte, quoted_text: clause.text },
    verification: "VERIFIED",
  };
}

function wholeDocCitation(designRef, text) {
  const end = Buffer.byteLength(text, "utf8");
  return {
    repo: designRef.repo,
    path: designRef.path,
    commit: designRef.commit,
    blob: designRef.blob,
    algorithm: "git-sha1",
    revision: designRef.revision,
    quoted_span: text,
    span: { start_byte: 0, end_byte: end, quoted_text: text },
    verification: "VERIFIED",
  };
}

/**
 * Charge one span per generated citation (AR-004 defined model: every
 * span operation — extraction, verification, generation — is budgeted).
 */
function emitEvidence(budget, items) {
  if (budget) for (const _ of items) budget.countSpan();
  return items;
}

function findingId(designRef, checkId, clauseKey, spanStart, spanEnd) {
  return stableFindingId(designRef.repo, designRef.path, designRef.blob, checkId, clauseKey, spanStart, spanEnd);
}

/**
 * Evaluate a resolved design. Returns the agent payload (without the
 * common envelope). Throws ReviewerError for blocked/refused states.
 */
export function evaluateReview(task, designRef, bytes, requiredCheckIds, injection, budget, context) {
  const byteLen = Buffer.byteLength(bytes, "utf8");
  const rawClauses = extractClauses(bytes, budget);
  const clauses = dedupeClauses(rawClauses);
  const byCheck = new Map(CHECK_IDS.map((id) => [id, []]));
  for (const c of clauses) byCheck.get(c.check_id).push(c);

  const findings = [];
  const contradictions = [];
  const coverage = { required: [...requiredCheckIds].sort(), verified: [], missing: [], unverifiable: [] };
  let hasBlocker = false;
  let hasMajor = false;

  // Authority-spoof is neutralized, never honored: INFO finding, review
  // proceeds on the structured clauses.
  for (const s of injection.authoritySpoof) {
    findings.push({
      finding_id: findingId(designRef, "authority-spoof", s.quoted_text, s.start_byte, s.end_byte),
      check_id: "authority-spoof",
      severity: "INFO",
      validity: "GROUNDED",
      text: "design text asserts reviewer/verdict authority; neutralized — advisory output is never an authorization",
      evidence: emitEvidence(budget, [
        {
          repo: designRef.repo, path: designRef.path, commit: designRef.commit, blob: designRef.blob,
          algorithm: "git-sha1", revision: designRef.revision,
          quoted_span: s.quoted_text,
          span: { start_byte: s.start_byte, end_byte: s.end_byte, quoted_text: s.quoted_text },
          verification: "VERIFIED",
        },
      ]),
      uncertainty_flags: ["AUTHORITY_SPOOF_NEUTRALIZED"],
    });
  }

  for (const checkId of coverage.required) {
    const list = byCheck.get(checkId) ?? [];
    if (list.length === 0) {
      // Missing required clause, evidenced by complete bounded document
      // coverage — not a fabricated quote.
      const fid = findingId(designRef, checkId, "absent", 0, byteLen);
      findings.push({
        finding_id: fid,
        check_id: checkId,
        severity: "MAJOR",
        validity: "GROUNDED",
        text: `required clause for check '${checkId}' absent from the fully read design document (${byteLen} bytes, ${rawClauses.length} clause(s) parsed)`,
        evidence: emitEvidence(budget, [wholeDocCitation(designRef, bytes)]),
        uncertainty_flags: [],
      });
      coverage.missing.push(checkId);
      hasMajor = true;
      continue;
    }

    // AR-002: same-line duplicate keys are never last-wins repaired.
    // Conflicting duplicates classify as contradictions (both occurrences
    // preserved); identical duplicates collapse silently.
    let dupConflict = false;
    for (const c of list) {
      for (const d of c.duplicates) {
        const vals = d.values.map(normValue);
        if (new Set(vals).size > 1) {
          dupConflict = true;
          contradictions.push({
            check_id: checkId,
            field: d.key,
            value_a: d.values[0],
            value_b: d.values[d.values.length - 1],
            source_a: c.text,
            source_b: c.text,
            span_a: { start_byte: c.start_byte, end_byte: c.end_byte },
            span_b: { start_byte: c.start_byte, end_byte: c.end_byte },
          });
        }
      }
    }
    if (dupConflict) {
      const fid = findingId(designRef, checkId, "duplicate-field-contradiction", list[0].start_byte, list[list.length - 1].end_byte);
      findings.push({
        finding_id: fid,
        check_id: checkId,
        severity: "MAJOR",
        validity: "GROUNDED",
        text: `check '${checkId}' has same-line duplicate control field(s) with conflicting values; occurrences preserved, never repaired`,
        evidence: emitEvidence(budget, list.map((c) => clauseCitation(designRef, c))),
        uncertainty_flags: ["UNRESOLVED_CONTRADICTION"],
      });
      hasMajor = true;
      continue;
    }

    // AR-002: unknown control fields and malformed structured clauses
    // cannot support check verification — the check is unverifiable.
    const badClauses = list.filter((c) => c.unknownFields.length > 0 || c.malformed.length > 0);
    if (badClauses.length > 0) {
      for (const c of badClauses) {
        const problems = [
          ...c.unknownFields.map((f) => `unknown control field '${f}'`),
          ...c.malformed.map((f) => `malformed clause fragment '${f}'`),
        ];
        const fid = findingId(designRef, checkId, `unverifiable:${problems.join("|").slice(0, 48)}`, c.start_byte, c.end_byte);
        findings.push({
          finding_id: fid,
          check_id: checkId,
          severity: "MAJOR",
          validity: "GROUNDED",
          text: `check '${checkId}' clause cannot support verification: ${problems.join("; ")}`,
          evidence: emitEvidence(budget, [clauseCitation(designRef, c)]),
          uncertainty_flags: ["UNVERIFIABLE_CLAUSE"],
        });
      }
      coverage.unverifiable.push(checkId);
      hasMajor = true;
      continue;
    }

    const pairs = detectContradictions(checkId, list);
    if (pairs.length > 0) {
      for (const p of pairs) {
        contradictions.push({
          check_id: checkId,
          field: p.field,
          value_a: p.valueA,
          value_b: p.valueB,
          source_a: p.a.text,
          source_b: p.b.text,
          span_a: { start_byte: p.a.start_byte, end_byte: p.a.end_byte },
          span_b: { start_byte: p.b.start_byte, end_byte: p.b.end_byte },
        });
      }
      const fid = findingId(designRef, checkId, "contradiction", list[0].start_byte, list[list.length - 1].end_byte);
      findings.push({
        finding_id: fid,
        check_id: checkId,
        severity: "MAJOR",
        validity: "GROUNDED",
        text: `check '${checkId}' has ${pairs.length} unresolved contradiction(s); both conflicting clauses preserved, values not averaged`,
        evidence: emitEvidence(budget, list.map((c) => clauseCitation(designRef, c))),
        uncertainty_flags: ["UNRESOLVED_CONTRADICTION"],
      });
      hasMajor = true;
      continue;
    }
    const ev = evaluateCheck(checkId, list);
    if (ev.forbidden) {
      const fid = findingId(designRef, checkId, "forbidden", list[0].start_byte, list[list.length - 1].end_byte);
      findings.push({
        finding_id: fid,
        check_id: checkId,
        severity: "BLOCKER",
        validity: "GROUNDED",
        text: `check '${checkId}': ${ev.forbidden.detail}`,
        evidence: emitEvidence(budget, list.map((c) => clauseCitation(designRef, c))),
        uncertainty_flags: [],
      });
      hasBlocker = true;
      continue;
    }
    for (const d of ev.defects) {
      const fid = findingId(designRef, checkId, `defect:${d.field}`, list[0].start_byte, list[list.length - 1].end_byte);
      findings.push({
        finding_id: fid,
        check_id: checkId,
        severity: "MAJOR",
        validity: "GROUNDED",
        text: `check '${checkId}': ${d.detail}`,
        evidence: emitEvidence(budget, list.map((c) => clauseCitation(designRef, c))),
        uncertainty_flags: [],
      });
      hasMajor = true;
    }
    if (ev.defects.length === 0) coverage.verified.push(checkId);
  }

  // Prior-round advisory verdicts are context only and never reused: a
  // newer NEEDS CHANGES/NO-GO supersedes an old GO on current evidence.
  if (task.prior_round_verdict && task.prior_round_verdict.value === "GO") {
    const fid = findingId(designRef, "prior-round", "supersession", 0, 0);
    findings.push({
      finding_id: fid,
      check_id: "prior-round",
      severity: "INFO",
      validity: "GROUNDED",
      text: `prior round '${task.prior_round_verdict.round}' verdict GO does not carry: this review is derived from current design bytes only`,
      evidence: emitEvidence(budget, [wholeDocCitation(designRef, bytes)]),
      uncertainty_flags: ["PRIOR_ROUND_SUPERSEDED"],
    });
  }

  findings.sort((a, b) => (a.finding_id < b.finding_id ? -1 : a.finding_id > b.finding_id ? 1 : 0));
  contradictions.sort((a, b) =>
    a.check_id < b.check_id ? -1 : a.check_id > b.check_id ? 1 : a.field < b.field ? -1 : 1
  );

  let verdict, reason;
  if (hasBlocker) {
    verdict = "NO-GO";
    reason = "forbidden design boundary present (nonrepairable); advisory only";
  } else if (hasMajor || contradictions.length > 0) {
    verdict = "NEEDS CHANGES";
    reason = "evidenced repairable defects or unresolved contradictions; advisory only";
  } else {
    verdict = "GO";
    reason = "full required-check coverage, no unresolved contradictions, no structural blockers, no injection, all pins verified; advisory only";
  }

  const reviewId = stableReviewId(designRef, task.base_pin, task.scope_ids ?? [], requiredCheckIds);
  return {
    status: "REVIEWED",
    review_id: reviewId,
    design_ref: { ...designRef },
    base_pin: { ...task.base_pin },
    coverage,
    findings,
    contradictions,
    verdict_proposal: { value: verdict, advisory: true, reason },
    authorization_granted: false,
    complete: true,
  };
}

/**
 * Verify task-supplied evidence_refs against the resolved design bytes.
 * Called BEFORE any success verdict (AR-003): every consulted ref is
 * charged to the budget, slices are validated with fatal UTF-8 decoding
 * (no replacement decoding — a slice splitting a multi-byte character
 * fails), and the ref's full source identity (including revision) must
 * match design_ref. Returns error diagnostics; the caller blocks on any.
 */
export function verifyEvidenceRefs(task, bytes, budget) {
  const diags = [];
  const designRef = task.design_ref;
  const buf = Buffer.from(bytes, "utf8");
  const refs = task.evidence_refs ?? [];
  for (let i = 0; i < refs.length; i++) {
    const e = refs[i];
    budget.countObject();
    budget.countPayload(canonicalJson(e));
    const r = e.design_ref;
    if (
      r.repo !== designRef.repo || r.path !== designRef.path || r.commit !== designRef.commit ||
      r.blob !== designRef.blob || r.revision !== designRef.revision
    ) {
      diags.push({
        code: "TARGET_MISMATCH",
        severity: "error",
        source_ref: { ...designRef },
        record_id: null,
        reason: `evidence_refs[${i}] names a different design source than design_ref`,
      });
      continue;
    }
    budget.countSpan();
    const { start_byte, end_byte, quoted_text } = e.span;
    if (!Number.isInteger(start_byte) || !Number.isInteger(end_byte) || start_byte < 0 || end_byte < start_byte || end_byte > buf.length) {
      diags.push({
        code: "SPAN_MISMATCH",
        severity: "error",
        source_ref: { ...designRef },
        record_id: null,
        reason: `evidence_refs[${i}] span bounds are out of range`,
      });
      continue;
    }
    let slice;
    try {
      // Fatal decoding: no replacement characters — a slice that splits
      // a multi-byte UTF-8 sequence is invalid, not silently repaired.
      slice = new TextDecoder("utf-8", { fatal: true }).decode(buf.subarray(start_byte, end_byte));
    } catch {
      diags.push({
        code: "SPAN_MISMATCH",
        severity: "error",
        source_ref: { ...designRef },
        record_id: null,
        reason: `evidence_refs[${i}] span is not valid UTF-8 at its byte boundaries`,
      });
      continue;
    }
    if (slice !== quoted_text) {
      diags.push({
        code: "SPAN_MISMATCH",
        severity: "error",
        source_ref: { ...designRef },
        record_id: null,
        reason: `evidence_refs[${i}] span quoted_text does not equal the exact UTF-8 slice`,
      });
    }
  }
  return diags;
}
