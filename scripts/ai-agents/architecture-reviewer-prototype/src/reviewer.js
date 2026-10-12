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
import { stableFindingId, stableReviewId } from "./canonical.js";

export class ReviewerError extends Error {
  constructor(code, status, reason) {
    super(reason);
    this.name = "ReviewerError";
    this.code = code;
    this.status = status;
  }
}

const CLAUSE_RE = /^\s*\[check:([a-z0-9-]+)\]\s*(.*)$/;

/** Parse clause fields: `key: value; key2: value2`. */
function parseFields(rest) {
  const fields = {};
  for (const part of rest.split(";")) {
    const m = part.match(/^\s*([a-zA-Z0-9_]+)\s*:\s*(.*?)\s*$/);
    if (m) fields[m[1]] = m[2];
  }
  return fields;
}

/**
 * Extract clauses from design text with exact UTF-8 byte spans.
 * Returns [{check_id, fields, text, start_byte, end_byte}].
 */
export function extractClauses(text) {
  const clauses = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    const lineBytes = Buffer.byteLength(line, "utf8");
    const m = line.match(CLAUSE_RE);
    if (m && CHECK_DEFS[m[1]]) {
      clauses.push({
        check_id: m[1],
        fields: parseFields(m[2]),
        text: line,
        start_byte: offset,
        end_byte: offset + lineBytes,
      });
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
    quoted_span: text,
    span: { start_byte: 0, end_byte: end, quoted_text: text },
    verification: "VERIFIED",
  };
}

function findingId(designRef, checkId, clauseKey, spanStart, spanEnd) {
  return stableFindingId(designRef.repo, designRef.path, designRef.blob, checkId, clauseKey, spanStart, spanEnd);
}

/**
 * Evaluate a resolved design. Returns the agent payload (without the
 * common envelope). Throws ReviewerError for blocked/refused states.
 */
export function evaluateReview(task, designRef, bytes, requiredCheckIds, injection, budget, context) {
  void budget;
  const byteLen = Buffer.byteLength(bytes, "utf8");
  const rawClauses = extractClauses(bytes);
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
      evidence: [
        {
          repo: designRef.repo, path: designRef.path, commit: designRef.commit, blob: designRef.blob,
          algorithm: "git-sha1",
          quoted_span: s.quoted_text,
          span: { start_byte: s.start_byte, end_byte: s.end_byte, quoted_text: s.quoted_text },
          verification: "VERIFIED",
        },
      ],
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
        evidence: [wholeDocCitation(designRef, bytes)],
        uncertainty_flags: [],
      });
      coverage.missing.push(checkId);
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
        evidence: list.map((c) => clauseCitation(designRef, c)),
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
        evidence: list.map((c) => clauseCitation(designRef, c)),
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
        evidence: list.map((c) => clauseCitation(designRef, c)),
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
      evidence: [wholeDocCitation(designRef, bytes)],
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

/** Verify task-supplied evidence_refs against the resolved design bytes. */
export function verifyEvidenceRefs(task, bytes, budget) {
  void budget;
  const diags = [];
  const designRef = task.design_ref;
  for (let i = 0; i < (task.evidence_refs ?? []).length; i++) {
    const e = task.evidence_refs[i];
    const r = e.design_ref;
    if (r.repo !== designRef.repo || r.path !== designRef.path || r.commit !== designRef.commit || r.blob !== designRef.blob) {
      diags.push({
        code: "TARGET_MISMATCH",
        severity: "error",
        source_ref: { ...designRef },
        record_id: null,
        reason: `evidence_refs[${i}] names a different design source than design_ref`,
      });
      continue;
    }
    const buf = Buffer.from(bytes, "utf8");
    if (e.span.end_byte > buf.length || buf.subarray(e.span.start_byte, e.span.end_byte).toString("utf8") !== e.span.quoted_text) {
      diags.push({
        code: "SPAN_MISMATCH",
        severity: "error",
        source_ref: { ...designRef },
        record_id: null,
        reason: `evidence_refs[${i}] span does not verify against resolved design bytes`,
      });
    }
  }
  return diags;
}
