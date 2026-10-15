/**
 * detector.js — synthetic documentation drift detection pipeline.
 *
 * Input: {repo, doc_ref, code_refs, claim_specs, requested_action:"propose"}.
 * Output: {status:"READY"|"BLOCKED"|"UNVERIFIABLE"|"REFUSED", proposal_id,
 * advisory:true, doc_ref, code_evidence:[Citation], proposed_diff|null,
 * claims:[...], excluded_claims:[...], uncertainty_flags:[],
 * reviewer_preview:[]}.
 *
 * READY requires all emitted claims supported and an exact diff applicable
 * to the pinned doc; uncited claims are excluded, with an
 * UNVERIFIABLE/incomplete envelope if requested coverage is not achieved.
 * Missing mandatory/read-denied evidence -> BLOCKED. No drift -> READY
 * with an empty diff, explicit no-change, zero inferred claims.
 * proposed_diff is inert text; it is never applied to real files.
 * Refusal/injection produces no prohibited claim.
 * Pure Node 24 ESM, zero dependencies.
 */

import { canonicalJson, sha256HexUtf8 } from "./canonical.js";
import { BudgetError, ResolutionError, resolveSourceRef, hasReadGrant, verifySpan, lineIndex, lineIndexOf } from "./resolver.js";
import { scanText, scanTaskStrings, FAMILIES } from "./injection.js";
import {
  parseBehaviorKey, isKnownBehavior, parseCodeFixture, parseDocValue,
  renderValue, valuesEqual, effectiveCodeValue, checkRequiredUsageSpanIds,
} from "./extraction.js";

const PROHIBITED_ACTIONS = new Set([
  "apply", "commit", "merge", "deploy", "push", "activate", "write", "self-approve", "approve",
]);

function diag(code, severity, reason, sourceRef = null, recordId = null) {
  return { code, severity, source_ref: sourceRef, record_id: recordId, reason };
}

function citationOf(ref, span) {
  return {
    repo: ref.repo,
    path: ref.path,
    commit: ref.commit,
    blob: ref.blob,
    algorithm: "git-sha1",
    revision: ref.revision,
    quoted_span: span.quoted_text,
    span: { start_byte: span.start_byte, end_byte: span.end_byte, quoted_text: span.quoted_text },
    verification: "VERIFIED",
  };
}

function proposalIdOf(task) {
  const core = {
    repo: task.repo,
    doc_ref: task.doc_ref,
    code_refs: task.code_refs,
    claim_specs: task.claim_specs,
    requested_action: task.requested_action,
  };
  return `doc-${sha256HexUtf8(canonicalJson(core)).slice(0, 16)}`;
}

export { proposalIdOf, buildDiff };

/**
 * Byte range of a claim phrase within the document.
 *
 * docSpanAbs.start_byte is a UTF-8 byte offset; docPhrase.phrase_start /
 * phrase_end are UTF-16 code-unit indexes from the regex match into the
 * quoted text. Adding them directly (DOC-001) corrupts replacements when
 * multibyte text precedes the phrase on the line. Convert the string
 * prefix to bytes explicitly so every offset below is a UTF-8 byte offset.
 */
function phraseByteRange(docSpanAbs, quotedText, phraseStart, phrase) {
  const startByte = docSpanAbs.start_byte + Buffer.byteLength(quotedText.slice(0, phraseStart), "utf8");
  const endByte = startByte + Buffer.byteLength(phrase, "utf8");
  return { startByte, endByte };
}

/**
 * Build the inert proposed_diff for drifted claims: hunks over the pinned
 * doc lines, before/after as exact line arrays. Claims sharing a doc line
 * merge into one hunk; replacement operations are normalized before
 * mutation (DOC-004): identical ranges with identical bytes coalesce to
 * one application, conflicting or partially overlapping ranges fail
 * closed, and only provably disjoint operations are applied in descending
 * byte order.
 *
 * Replacements are applied over Buffer byte ranges, never String slice
 * indexes: JavaScript string indexes are UTF-16 code units, not UTF-8
 * bytes, so slice() on byte offsets shifts replacements when multibyte
 * text precedes the claim (DOC-001). Any range that does not lie wholly
 * within its line's byte range fails closed.
 */
function buildDiff(docRef, docText, driftedClaims) {
  const lines = lineIndex(docText);
  const byLine = new Map();
  for (const c of driftedClaims) {
    const { startByte } = phraseByteRange(c.docSpanAbs, c.before, c.docPhrase.phrase_start, c.docPhrase.phrase);
    const li = lineIndexOf(lines, startByte);
    if (!byLine.has(li)) byLine.set(li, []);
    byLine.get(li).push(c);
  }
  const hunks = [];
  for (const [li, claims] of [...byLine.entries()].sort((a, b) => a[0] - b[0])) {
    const line = lines[li];
    const lineBuf = Buffer.from(line.text, "utf8");
    // Invariant from lineIndex: byte length matches the byte range.
    if (lineBuf.length !== line.end_byte - line.start_byte) {
      throw new Error(`buildDiff: line ${li} byte length mismatch`);
    }
    // DOC-004: normalize replacement operations BEFORE mutation.
    // Every range is validated against the ORIGINAL line bytes first.
    // Identical ranges with identical replacement bytes coalesce to a
    // single application (duplicate claims are permitted by the schema).
    // A conflicting same-range replacement or any partial overlap fails
    // closed — the emitted diff must equal exactly the claimed corrections.
    const raw = claims.map((c) => {
      const { startByte, endByte } = phraseByteRange(c.docSpanAbs, c.before, c.docPhrase.phrase_start, c.docPhrase.phrase);
      const relStart = startByte - line.start_byte;
      const relEnd = endByte - line.start_byte;
      // Fail closed: the phrase byte range must lie wholly within this line.
      if (relStart < 0 || relEnd > lineBuf.length || relStart > relEnd) {
        throw new Error(`buildDiff: phrase byte range [${startByte},${endByte}) outside line ${li} byte range`);
      }
      return { absStart: startByte, absEnd: endByte, relStart, relEnd, after: c.afterPhrase, claim_id: c.claim_id };
    });
    const byRange = new Map();
    for (const r of raw) {
      const key = `${r.absStart}:${r.absEnd}`;
      if (!byRange.has(key)) byRange.set(key, []);
      byRange.get(key).push(r);
    }
    const reps = [];
    for (const [key, group] of byRange) {
      const afters = new Set(group.map((g) => g.after));
      if (afters.size > 1) {
        throw new Error(
          `buildDiff: conflicting replacements for identical byte range ${key} ` +
          `(claims ${group.map((g) => g.claim_id).join(",")}): refusing corrupt diff`
        );
      }
      reps.push(group[0]);
    }
    // Only disjoint operations may be applied: sort by start and reject
    // any partial overlap (adjacent ranges, where one ends exactly where
    // the next begins, are disjoint and permitted).
    reps.sort((a, b) => a.absStart - b.absStart);
    for (let i = 1; i < reps.length; i++) {
      if (reps[i].absStart < reps[i - 1].absEnd) {
        throw new Error(
          `buildDiff: overlapping replacement ranges ` +
          `[${reps[i - 1].absStart},${reps[i - 1].absEnd}) and [${reps[i].absStart},${reps[i].absEnd}) ` +
          `(claims ${reps[i - 1].claim_id},${reps[i].claim_id}): refusing corrupt diff`
        );
      }
    }
    // Apply replacements in descending absolute byte order so offsets stay valid.
    reps.sort((a, b) => b.absStart - a.absStart);
    let newBuf = lineBuf;
    for (const r of reps) {
      newBuf = Buffer.concat([
        newBuf.subarray(0, r.relStart),
        Buffer.from(r.after, "utf8"),
        newBuf.subarray(r.relEnd),
      ]);
    }
    hunks.push({
      start_line: li,
      end_line: li + 1,
      before: [line.text],
      after: [newBuf.toString("utf8")],
    });
  }
  return {
    doc: { repo: docRef.repo, path: docRef.path, commit: docRef.commit, blob: docRef.blob },
    hunks,
  };
}

function markdownPreview(proposalId, status, docRef, claims, excluded, uncertaintyFlags, diff, diagnostics, complete) {
  const blocks = [];
  blocks.push(`# Documentation drift proposal ${proposalId}`);
  blocks.push(``);
  blocks.push(`Status: ${status} — doc \`${docRef.repo}/${docRef.path}@${docRef.commit.slice(0, 8)}\` (advisory, fixture-only).`);
  blocks.push(``);
  for (const c of claims) {
    blocks.push(`## claim ${c.claim_id} — ${c.support_status}`);
    blocks.push(`- Before: \`${c.before}\``);
    blocks.push(`- After: \`${c.after}\``);
    for (const cit of c.citations) {
      blocks.push(`- Citation: \`${cit.repo}/${cit.path}@${cit.commit.slice(0, 8)}\` \`${cit.quoted_span}\` [${cit.verification}]`);
    }
    for (const u of c.usage_citations) {
      blocks.push(`- Usage: \`${u.repo}/${u.path}@${u.commit.slice(0, 8)}\` \`${u.quoted_span}\` [${u.verification}]`);
    }
    blocks.push(`- Coverage: doc bytes ${c.docSpanAbs.start_byte}–${c.docSpanAbs.end_byte} verified; code value pinned to blob ${c.codeBlobShort}.`);
    blocks.push(``);
  }
  if (excluded.length > 0) {
    blocks.push(`## Excluded claims`);
    for (const e of excluded) blocks.push(`- ${e.claim_id}: ${e.reason}`);
    blocks.push(``);
  }
  if (uncertaintyFlags.length > 0) {
    blocks.push(`## Uncertainty`);
    for (const u of uncertaintyFlags) blocks.push(`- [${u.code}] ${u.claim_id}: ${u.detail}`);
    blocks.push(``);
  }
  if (diff && diff.hunks.length > 0) {
    blocks.push(`## Proposed diff (inert — never applied to real files)`);
    for (const h of diff.hunks) {
      blocks.push(`- lines ${h.start_line + 1}:`);
      for (const b of h.before) blocks.push(`  - \`${b}\``);
      for (const a of h.after) blocks.push(`  + \`${a}\``);
    }
    blocks.push(``);
  } else if (diff) {
    blocks.push(`## Proposed diff`);
    blocks.push(`No drift: empty diff, explicit no-change.`);
    blocks.push(``);
  }
  if (diagnostics.length > 0) {
    blocks.push(`## Diagnostics`);
    for (const d of diagnostics) blocks.push(`- [${d.severity}] ${d.code}: ${d.reason}`);
    blocks.push(``);
  }
  blocks.push(`_Advisory fixture output only — complete=${complete}; not an execution token._`);
  return blocks;
}

/**
 * Main pipeline. Returns the agent payload (without the common envelope
 * fields, which index.js adds).
 */
export function detectDrift(task, ctx, budget) {
  const proposal_id = proposalIdOf(task);
  const diagnostics = [];
  const quarantined_sources = [];
  const uncertainty_flags = [];
  const claims = [];
  const excluded_claims = [];
  const code_evidence = [];

  const refused = (code, severity, reason) => ({
    status: "REFUSED", proposal_id, doc_ref: task.doc_ref, code_evidence: [],
    proposed_diff: null, claims: [], excluded_claims: [],
    uncertainty_flags: [], reviewer_preview: [],
    diagnostics: [diag(code, severity, reason)], quarantined_sources,
    routing_flags: [], complete: false,
  });

  // 1. Requested action gate.
  const action = String(task.requested_action).toLowerCase();
  if (action !== "propose") {
    if (PROHIBITED_ACTIONS.has(action)) {
      return refused("ACTION_DENIED", "critical", `prohibited requested_action '${task.requested_action}': this prototype proposes inert diffs only; it cannot apply, commit, merge, deploy or approve anything`);
    }
    return refused("UNSUPPORTED_TASK", "error", `unsupported requested_action '${task.requested_action}': only "propose" is supported`);
  }

  // 2. Self-approval / simulation gate (SEC-005). The fixture application
  //    simulator needs an independently scoped result-head GO plus Muse
  //    agreement; slice 1 cannot verify that, so any simulation or
  //    self-issued approval is refused outright.
  if (task.approval && /self|agent|myself/i.test(`${task.approval.approver} ${task.approval.scope}`)) {
    return refused("ACTION_DENIED", "critical", "self-issued approval rejected: the agent cannot approve its own output");
  }
  if (task.simulation) {
    return refused("ACTION_DENIED", "critical", "fixture application simulation not authorized in slice 1: requires an independently scoped result-head GO plus Muse agreement, which this prototype cannot verify");
  }

  // 3. Task-string injection scan.
  const hits = scanTaskStrings(task);
  if (hits.length > 0) {
    const families = [...new Set(hits.flatMap((h) => h.families))];
    if (families.includes(FAMILIES.SEC_004) || families.includes(FAMILIES.SEC_005)) {
      return refused("ACTION_DENIED", "critical", `task contains prohibited directive content (${families.join(",")}); refused, no claims produced`);
    }
    return refused("INSTRUCTION_INJECTION", "critical", `task contains seeded injection content (${families.join(",")}); refused, no claims produced`);
  }

  // 4. Resolve the doc source.
  let docText = null;
  let docBytes = null;
  let docQuarantined = false;
  // DOC-003: track verified sources for the envelope's source_refs.
  // Deterministic order: verified doc first, then non-quarantined code
  // refs in task order. Denial paths report only what was verified.
  // DOC-003 residual: a quarantined doc stays identifiable in
  // quarantined_sources but must never appear in the verified provenance
  // projection. docQuarantined is set by the injection scan below; this
  // closure reads it at call time, so every post-scan path — including
  // all early returns — filters the quarantined doc ref.
  let verifiedDocRef = null;
  const verifiedCodeRefs = [];
  const sourceRefs = () => [
    ...(verifiedDocRef && !docQuarantined ? [verifiedDocRef] : []),
    ...verifiedCodeRefs,
  ];
  if (!hasReadGrant(task.doc_ref, ctx.readGrants)) {
    return {
      status: "BLOCKED", proposal_id, doc_ref: task.doc_ref, code_evidence: [],
      proposed_diff: null, claims: [], excluded_claims: [],
      uncertainty_flags: [], reviewer_preview: [],
      diagnostics: [diag("READ_DENIED", "error", `read grant missing for doc ${task.doc_ref.repo}/${task.doc_ref.path}`, task.doc_ref)],
      quarantined_sources, routing_flags: [], complete: false,
    };
  }
  try {
    const resolved = resolveSourceRef(task.doc_ref, ctx.store.sources, budget);
    if (resolved.kind !== "doc") throw new ResolutionError("SOURCE_UNVERIFIED", "doc_ref does not resolve to a doc fixture");
    docBytes = resolved.bytes;
    docText = resolved.text;
    verifiedDocRef = task.doc_ref;
  } catch (e) {
    if (e instanceof ResolutionError || e instanceof BudgetError) {
      const code = e instanceof BudgetError ? e.code : e.code;
      return {
        status: e instanceof BudgetError ? "REFUSED" : "BLOCKED",
        proposal_id, doc_ref: task.doc_ref, code_evidence: [],
        proposed_diff: null, claims: [], excluded_claims: [],
        uncertainty_flags: [], reviewer_preview: [],
        diagnostics: [diag(code, "error", `doc_ref: ${e.message}`, task.doc_ref)],
        quarantined_sources, routing_flags: [], complete: false,
      };
    }
    throw e;
  }
  const docScan = scanText(docText);
  if (docScan.injected) {
    docQuarantined = true;
    quarantined_sources.push({
      repo: task.doc_ref.repo,
      path: task.doc_ref.path,
      commit: task.doc_ref.commit,
      families: docScan.families,
      reason: `seeded injection content (${docScan.families.join(",")}); source quarantined, supports no claims`,
    });
  }

  // 5. Resolve code sources. Missing mandatory evidence -> BLOCKED.
  if (task.code_refs.length === 0) {
    return {
      status: "BLOCKED", proposal_id, doc_ref: task.doc_ref, code_evidence: [],
      source_refs: sourceRefs(),
      proposed_diff: null, claims: [], excluded_claims: [],
      uncertainty_flags: [], reviewer_preview: [],
      diagnostics: [diag("SOURCE_UNVERIFIED", "error", "missing mandatory evidence: code_refs is empty")],
      quarantined_sources, routing_flags: [], complete: false,
    };
  }
  const parsedFixtures = [];
  for (const ref of task.code_refs) {
    if (!hasReadGrant(ref, ctx.readGrants)) {
      return {
        status: "BLOCKED", proposal_id, doc_ref: task.doc_ref, code_evidence: [],
        source_refs: sourceRefs(),
        proposed_diff: null, claims: [], excluded_claims: [],
        uncertainty_flags: [], reviewer_preview: [],
        diagnostics: [diag("READ_DENIED", "error", `read grant missing for code ${ref.repo}/${ref.path}`, ref)],
        quarantined_sources, routing_flags: [], complete: false,
      };
    }
    try {
      const resolved = resolveSourceRef(ref, ctx.store.sources, budget);
      if (resolved.kind !== "code") throw new ResolutionError("SOURCE_UNVERIFIED", "code_ref does not resolve to a code fixture");
      const codeScan = scanText(resolved.text);
      if (codeScan.injected) {
        quarantined_sources.push({
          repo: ref.repo, path: ref.path, commit: ref.commit,
          families: codeScan.families,
          reason: `seeded injection content (${codeScan.families.join(",")}); source quarantined, supports no claims`,
        });
        continue;
      }
      budget.countConsulted(`parse ${ref.repo}/${ref.path}`);
      parsedFixtures.push({ ref, parsed: parseCodeFixture(resolved.text), bytes: resolved.bytes });
      verifiedCodeRefs.push(ref);
    } catch (e) {
      if (e instanceof ResolutionError || e instanceof BudgetError) {
        const code = e instanceof BudgetError ? e.code : e.code;
        return {
          status: e instanceof BudgetError ? "REFUSED" : "BLOCKED",
          proposal_id, doc_ref: task.doc_ref, code_evidence: [],
          source_refs: sourceRefs(),
          proposed_diff: null, claims: [], excluded_claims: [],
          uncertainty_flags: [], reviewer_preview: [],
          diagnostics: [diag(code, "error", `code_ref ${ref.repo}/${ref.path}: ${e.message}`, ref)],
          quarantined_sources, routing_flags: [], complete: false,
        };
      }
      throw e;
    }
  }

  // Index evidence spans across non-quarantined fixtures.
  const evidenceById = new Map();
  for (const pf of parsedFixtures) {
    for (const s of pf.parsed.spans) {
      if (!evidenceById.has(s.span_id)) evidenceById.set(s.span_id, { span: s, fixture: pf });
    }
  }

  // 6. Per-claim evaluation.
  const driftedClaims = [];
  for (const spec of task.claim_specs) {
    const cid = spec.claim_id;
    const exclude = (reason, severity = "warning", code = null) => {
      excluded_claims.push({ claim_id: cid, reason });
      diagnostics.push(diag(code ?? "EXCLUDED_CLAIM", severity, `claim ${cid} excluded: ${reason}`));
    };

    if (docQuarantined) {
      exclude("SEC_002_QUARANTINE", "warning", "INSTRUCTION_INJECTION");
      continue;
    }

    // Verify the doc span against pinned doc bytes.
    let docSpanAbs;
    try {
      docSpanAbs = verifySpan(docBytes, spec.doc_span.quoted_text, spec.doc_span.start_byte, spec.doc_span.end_byte, `claim ${cid} doc_span`, budget);
    } catch (e) {
      if (e instanceof ResolutionError) {
        exclude(`SPAN_MISMATCH: ${e.message}`, "warning", "SPAN_MISMATCH");
        continue;
      }
      throw e;
    }

    // Behavior must be in the bounded set.
    if (!isKnownBehavior(spec.behavior_key)) {
      exclude(`UNKNOWN_BEHAVIOR: '${spec.behavior_key}' is not a bounded fixture behavior`, "warning", "UNSUPPORTED_TASK");
      continue;
    }

    // Parse the documented value from the verified span.
    const docParsed = parseDocValue(spec.behavior_key, spec.doc_span.quoted_text);
    if (!docParsed.ok) {
      exclude(`${docParsed.reason}: doc span carries no parseable ${spec.behavior_key} value`, "warning", docParsed.reason);
      continue;
    }

    // Caller code_span_ids are hints: they must resolve to derived evidence.
    for (const spanId of spec.code_span_ids) {
      if (!evidenceById.has(spanId)) {
        exclude(`CALLER_SPAN_UNRESOLVED: '${spanId}' matches no derived evidence span`, "warning", "SPAN_MISMATCH");
      }
    }
    if (excluded_claims.some((e) => e.claim_id === cid)) continue;

    // Required usage spans must resolve to usage evidence of this behavior.
    if (spec.required_usage_span_ids.length > 0) {
      const check = checkRequiredUsageSpanIds(spec.required_usage_span_ids, spec.behavior_key, parsedFixtures);
      if (!check.ok) {
        exclude(`USAGE_REQUIREMENT_UNMET: required usage spans missing: ${check.missing.join(", ")}`, "warning", "USAGE_REQUIREMENT_UNMET");
        uncertainty_flags.push({ code: "USAGE_REQUIREMENT_UNMET", claim_id: cid, detail: `required usage spans not found in code evidence: ${check.missing.join(", ")}` });
        continue;
      }
    }

    // Effective code value with dead-constant / ambiguity / version rules.
    const eff = effectiveCodeValue(spec.behavior_key, parsedFixtures);
    if (eff.outcome !== "OK") {
      const reasonMap = {
        NO_CODE_EVIDENCE: "no code evidence for this behavior in any resolved fixture",
        UNKNOWN_GRAMMAR_VALUE: "code declaration uses an unsupported grammar form; value unknown",
        DEAD_CONSTANT: "declared constant has no production usage span; a bare constant never proves production behavior",
        AMBIGUOUS_USAGE: "usage spans do not attribute to the declared constant; effective production value ambiguous",
        PATH_CONFLICT: "active v1/v2 code paths disagree; conflicting paths retained, never averaged",
      };
      exclude(`${eff.outcome}: ${reasonMap[eff.outcome]}`, "warning", eff.outcome);
      uncertainty_flags.push({ code: eff.outcome, claim_id: cid, detail: reasonMap[eff.outcome] });
      continue;
    }

    // Compare documented vs effective code value.
    const citationOfSpan = (s) => {
      const pf = parsedFixtures.find((p) =>
        p.parsed.spans.some((x) => x.span_id === s.span_id && x.start_byte === s.start_byte)
      );
      return citationOf(pf.ref, s);
    };
    const citations = eff.citations.map(citationOfSpan);
    const usageCitations = eff.usageCitations.map(citationOfSpan);
    for (const c of [...citations, ...usageCitations]) {
      if (!code_evidence.some((e) => e.span.start_byte === c.span.start_byte && e.path === c.path && e.commit === c.commit)) {
        code_evidence.push(c);
      }
    }
    const afterPhrase = renderValue(spec.behavior_key, eff.value);
    const before = spec.doc_span.quoted_text;
    const after = before.slice(0, docParsed.phrase_start) + afterPhrase + before.slice(docParsed.phrase_end);

    if (valuesEqual(spec.behavior_key, docParsed.value, eff.value)) {
      claims.push({
        claim_id: cid,
        before,
        after: before,
        support_status: "SUPPORTED",
        citations,
        usage_citations: usageCitations,
        docSpanAbs,
        docPhrase: docParsed,
        afterPhrase,
        codeBlobShort: eff.citations[0] ? code_evidence.find((c) => c.quoted_span === eff.citations[0].quoted_text)?.blob.slice(0, 12) ?? "?" : "?",
      });
      diagnostics.push(diag("NO_DRIFT", "info", `claim ${cid}: documented value matches effective code value`));
    } else {
      const claim = {
        claim_id: cid,
        before,
        after,
        support_status: "DRIFTED",
        citations,
        usage_citations: usageCitations,
        docSpanAbs,
        docPhrase: docParsed,
        afterPhrase,
        codeBlobShort: code_evidence.find((c) => c.quoted_span === eff.citations[0].quoted_text)?.blob.slice(0, 12) ?? "?",
      };
      claims.push(claim);
      driftedClaims.push(claim);
      diagnostics.push(diag("DRIFT_DETECTED", "info", `claim ${cid}: doc says '${docParsed.phrase}', effective code value is '${afterPhrase}'`));
    }
  }

  diagnostics.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

  // 7. Status and diff.
  let status;
  let proposed_diff = null;
  if (excluded_claims.length > 0) {
    status = "UNVERIFIABLE";
  } else {
    status = "READY";
    if (driftedClaims.length > 0) {
      // Diff construction fails closed: any byte-range invariant violation
      // degrades to UNVERIFIABLE rather than emitting a corrupt diff.
      try {
        proposed_diff = buildDiff(task.doc_ref, docText, driftedClaims);
      } catch (e) {
        diagnostics.push(diag("DIFF_CONSTRUCTION_FAILED", "error", `diff construction failed closed: ${e.message}`));
        const strip = ({ docSpanAbs, docPhrase, afterPhrase, codeBlobShort, ...rest }) => rest;
        return {
          status: "UNVERIFIABLE", proposal_id, doc_ref: task.doc_ref, code_evidence,
          source_refs: sourceRefs(),
          proposed_diff: null, claims: claims.map(strip), excluded_claims,
          uncertainty_flags, reviewer_preview: [],
          diagnostics, quarantined_sources, routing_flags: [], complete: false,
        };
      }
    } else {
      proposed_diff = {
        doc: { repo: task.doc_ref.repo, path: task.doc_ref.path, commit: task.doc_ref.commit, blob: task.doc_ref.blob },
        hunks: [],
        no_change: true,
      };
    }
  }
  const complete = status === "READY";
  const reviewer_preview = markdownPreview(proposal_id, status, task.doc_ref, claims, excluded_claims, uncertainty_flags, proposed_diff, diagnostics, complete);

  return {
    status, proposal_id, doc_ref: task.doc_ref, code_evidence,
    source_refs: sourceRefs(),
    proposed_diff, claims: claims.map(({ docSpanAbs, docPhrase, afterPhrase, codeBlobShort, ...rest }) => rest),
    excluded_claims, uncertainty_flags, reviewer_preview,
    diagnostics, quarantined_sources, routing_flags: [], complete,
  };
}
