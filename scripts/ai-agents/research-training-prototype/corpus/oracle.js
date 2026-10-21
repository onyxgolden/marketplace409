/**
 * oracle.js — INDEPENDENT reference implementation of the Research
 * Training Agent Phase 2 slice 1 decision rules, authored directly
 * from the implementation brief (NOT by importing the candidate or
 * reusing its helpers). Used by corpus/make-battery.js to derive
 * expected battery outcomes for well-formed cases. Cases with
 * hard-coded expectations (malformed inputs, budget boundaries,
 * transport) bypass the oracle.
 *
 * This file is pinned in the corpus manifest like every other file.
 * It is an authoring tool, not part of the scored runtime path.
 */

import { createHash } from "node:crypto";

// ---- independent primitives (fresh code, not the candidate's) ----
function canon(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "bigint") return `{"$bigint":"${v.toString()}"}`;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("bad number");
    return JSON.stringify(v);
  }
  if (typeof v === "string" || typeof v === "boolean") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (typeof v === "object") {
    const ks = Object.keys(v).sort();
    return `{${ks.map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;
  }
  throw new Error("bad type");
}
const byteLen = (s) => Buffer.byteLength(s, "utf8");

// PER-006: framed tuple encoding — ("a","bc","d") and ("ab","c","d")
// are distinct keys; bare concatenation would merge them.
const KEY_OF = (a) => JSON.stringify([a.subject, a.predicate, a.scope]);
const LABEL_OF = (a) => `${a.subject} | ${a.predicate} | ${a.scope}`;

const INJ = [
  /SYSTEM\s+INSTRUCTION/i, /ignore\s+(all\s+)?previous\s+(rules|instructions)/i,
  /disregard\s+(the\s+)?(above|previous)/i, /you\s+are\s+now\s+(instructed|required)\s+to/i,
  /INJ-[A-Z0-9-]+/, /answer\s+key\s*(is|:)/i, /choice\s+[A-D]\s+is\s+correct/i,
  /the\s+correct\s+answer\s+is/i, /key\s*:\s*always\s+say/i, /<script[\s>]/i,
  /\beval\s*\(/, /\bFunction\s*\(/, /javascript\s*:/i, /on(error|load|click)\s*=/i,
  /approved\s+by\s+(the\s+)?(coordinator|orchestrator)/i,
  /this\s+source\s+is\s+(pre-)?verified/i, /treat\s+this\s+as\s+established\s+truth/i,
];

// PER-003 (closed schema, round 2): a root counts only when every
// key on the chain — source, links, terminal root, cycle members —
// is registered AND applicable: its applies_to list contains at
// least one SourceRef naming that link's own key. Any missing
// registration, or an absent/empty/self-naming-nothing applies_to
// at any link, makes the root unknown (null): no corroboration. A
// cycle resolves only when every member is fully applicable.
function rootOf(sourceKey, provSources) {
  const path = [];
  let cur = sourceKey;
  for (;;) {
    const idx = path.indexOf(cur);
    if (idx >= 0) return path.slice(idx).sort()[0];
    const e = provSources[cur];
    if (!e) return null;
    if (!Array.isArray(e.applies_to)) return null;
    if (!e.applies_to.some((r) => r && `${r.repo}|${r.path}` === cur)) return null;
    path.push(cur);
    if (e.copied_from === null || e.copied_from === undefined) return cur;
    cur = e.copied_from;
  }
}

// PER-003 (closed schema, round 2): a declaration binds ONLY the
// exact consumed SourceRefs its applies_to names (all six fields).
// Absent applies_to binds nothing.
function provApplies(entry, ref) {
  if (!entry) return false;
  if (!Array.isArray(entry.applies_to)) return false;
  return entry.applies_to.some((r) =>
    r.repo === ref.repo && r.path === ref.path && r.commit === ref.commit &&
    r.blob === ref.blob && r.algorithm === ref.algorithm && r.revision === ref.revision);
}

/**
 * oracleDecision(caseData) for well-formed cases.
 * caseData: { task, context } where task.request/context are the
 * validated shapes (builders in make-battery.js produce valid data).
 *
 * Returns the frozen expected fields:
 *   { status, quizzes: [assertion_ids], gaps: [topic_ids],
 *     rejected_codes: [codes], contradictions: [key labels],
 *     quarantined: [sourceKeys], diagnostics: [codes] }
 */
export function oracleDecision(task, context) {
  const req = task.options.request;
  // PER-001: principal liveness precedes any source work.
  const principal = context.principal;
  if (principal && (principal.revoked ||
      !(Date.parse(principal.valid_from) <= context.clock && context.clock <= Date.parse(principal.expires_at)))) {
    return { status: "REFUSED", quizzes: [], composites: [], gaps: [], rejected_codes: [], contradictions: [], quarantined: [], diagnostics: ["ACTION_DENIED"] };
  }
  const grantSet = new Set((context.readGrants || []).map((g) => `${g.repo}|${g.path}`));
  // PER-004: resolution is keyed by the complete pin identity; a
  // second, different pin on one path resolves on its own revision.
  const idOf = (r) => `${r.repo}|${r.path}|${r.commit}|${r.blob}|${r.algorithm}|${r.revision}`;
  const resolved = {};
  for (const ref of task.fixture_refs.source_refs || []) {
    const key = `${ref.repo}|${ref.path}`;
    const idk = idOf(ref);
    if (idk in resolved) continue;
    if (!grantSet.has(key)) {
      resolved[idk] = { granted: false };
      continue;
    }
    const entry = context.sources[key];
    const rev = entry.revisions[ref.commit];
    resolved[idk] = { granted: true, text: rev.text };
  }
  // quarantine: any seeded family anywhere in the FULL text (tracked
  // per resolved identity; reported per source key)
  const quarantinedIds = new Set();
  const quarantinedKeys = new Set();
  for (const [idk, r] of Object.entries(resolved)) {
    if (!r.granted) continue;
    if (INJ.some((re) => re.test(r.text))) {
      quarantinedIds.add(idk);
      const ref = (task.fixture_refs.source_refs || []).find((x) => idOf(x) === idk);
      quarantinedKeys.add(`${ref.repo}|${ref.path}`);
    }
  }
  const qList = () => [...quarantinedKeys].sort();
  // span proof + grammar
  const admitted = [];
  for (const a of req.assertions || []) {
    const ref = task.fixture_refs.source_refs[a.source_index];
    const key = `${ref.repo}|${ref.path}`;
    const r = resolved[idOf(ref)];
    if (!r.granted) { admitted.push({ ...a, _sourceKey: key, _denied: true }); continue; }
    if (quarantinedIds.has(idOf(ref))) { admitted.push({ ...a, _sourceKey: key, _quarantined: true }); continue; }
    const bytes = Buffer.from(r.text, "utf8");
    const slice = bytes.subarray(a.span.start_byte, a.span.end_byte);
    const text = slice.toString("utf8");
    if (text !== a.span.quoted_text || !Buffer.from(text, "utf8").equals(slice)) {
      return { status: "REFUSED", quizzes: [], composites: [], gaps: [], rejected_codes: [], contradictions: [], quarantined: qList(), diagnostics: ["SPAN_MISMATCH"] };
    }
    const parts = a.span.quoted_text.split(" | ");
    if (parts.length !== 4 || parts[0] !== a.subject || parts[1] !== a.predicate || parts[2] !== a.value || parts[3] !== a.scope) {
      return { status: "REFUSED", quizzes: [], composites: [], gaps: [], rejected_codes: [], contradictions: [], quarantined: qList(), diagnostics: ["INVALID_INPUT"] };
    }
    // PER-002: the grammar attests positive statements only; a
    // task-supplied negative polarity is unproven and refused.
    if (a.polarity !== "positive") {
      return { status: "REFUSED", quizzes: [], composites: [], gaps: [], rejected_codes: [], contradictions: [], quarantined: qList(), diagnostics: ["INVALID_INPUT"] };
    }
    admitted.push({ ...a, _sourceKey: key });
  }
  // statuses
  const teachable = admitted.filter((a) => !a._denied && !a._quarantined);
  const byKey = new Map();
  for (const a of teachable) {
    const k = KEY_OF(a);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(a);
  }
  const statusOf = new Map();
  for (const [k, list] of byKey) {
    const first = list[0];
    // PER-003: only assertions whose provenance declaration applies
    // to their consumed pin AND whose chain is fully registered
    // and fully applicable contribute an evidence root.
    const roots = new Set();
    for (const a of list) {
      const ref = task.fixture_refs.source_refs[a.source_index];
      if (!provApplies(context.provenance.sources[a._sourceKey], ref)) continue;
      const r = rootOf(a._sourceKey, context.provenance.sources);
      if (r !== null) roots.add(r);
    }
    const rootGroups = new Set([...roots].map((r) => context.provenance.sources[r].group));
    const contradicted = list.some((a) => a.value !== first.value || a.polarity !== first.polarity);
    statusOf.set(k, contradicted ? "contradicted" : (roots.size >= 2 && rootGroups.size >= 2 ? "supported" : "attributed-only"));
  }
  const quizzes = [];
  const quizSeen = new Set();
  const gaps = [];
  const contradictionLabels = new Set();
  const contradictions = [];
  const rejected = [];
  const composites = [];
  for (const topic of req.topics || []) {
    const preds = new Set(topic.predicates);
    const atoms = teachable.filter((a) => preds.has(a.predicate));
    let taught = false;
    for (const a of atoms) {
      const st = statusOf.get(KEY_OF(a));
      if (st === "contradicted") {
        if (!contradictionLabels.has(KEY_OF(a))) {
          contradictionLabels.add(KEY_OF(a));
          contradictions.push(LABEL_OF(a));
        }
        continue;
      }
      if (st === "unsupported") continue;
      taught = true;
      // One quiz per key, from the first-listed assertion for that key.
      if (!quizSeen.has(KEY_OF(a))) { quizSeen.add(KEY_OF(a)); quizzes.push(a.assertion_id); }
    }
    if (!taught) gaps.push(topic.topic_id);
  }
  for (const a of admitted.filter((a) => a._quarantined)) rejected.push("KEY_QUARANTINED");
  for (const a of admitted.filter((a) => a._denied)) rejected.push("KEY_DENIED_SOURCE");
  for (const c of req.composite_requests || []) {
    const [idA, idB] = c.atom_refs;
    const am = admitted.find((a) => a.assertion_id === idA);
    const bm = admitted.find((a) => a.assertion_id === idB);
    if (!am || !bm) { rejected.push("KEY_UNKNOWN_ATOM"); continue; }
    if (am._quarantined || bm._quarantined) { rejected.push("KEY_QUARANTINED"); continue; }
    if (am._denied || bm._denied) { rejected.push("KEY_DENIED_SOURCE"); continue; }
    const sa = statusOf.get(KEY_OF(am));
    const sb = statusOf.get(KEY_OF(bm));
    if (sa === "contradicted" || sb === "contradicted") { rejected.push("KEY_CONTRADICTED"); continue; }
    if (sa === "unsupported" || sb === "unsupported") { rejected.push("KEY_UNSUPPORTED"); continue; }
    composites.push(c.item_id);
  }
  for (const p of req.proposed_keys || []) {
    const a = admitted.find((x) => x.assertion_id === p.assertion_id);
    if (!a || a._denied || a._quarantined) { rejected.push("KEY_REJECTED"); continue; }
    const st = statusOf.get(KEY_OF(a));
    if (st !== "supported" && st !== "attributed-only") { rejected.push("KEY_REJECTED"); continue; }
    if (p.proposed_value !== a.value) rejected.push("KEY_UNSUPPORTED");
  }
  const diagnostics = [];
  const deniedKeys = new Set();
  for (const ref of task.fixture_refs.source_refs || []) {
    const r = resolved[idOf(ref)];
    if (r && !r.granted) deniedKeys.add(`${ref.repo}|${ref.path}`);
  }
  for (const _k of deniedKeys) diagnostics.push("SOURCE_DENIED");
  // PER-003 (round 2): one PROVENANCE_UNBOUND per distinct
  // teachable consumed source key whose binding fails — leaf
  // declaration does not name the exact consumed pin, OR the
  // chain walk returns null (missing/unbound ancestor).
  const unboundKeys = new Set();
  for (const a of teachable) {
    const ref = task.fixture_refs.source_refs[a.source_index];
    const leafOk = provApplies(context.provenance.sources[a._sourceKey], ref);
    const root = rootOf(a._sourceKey, context.provenance.sources);
    if (!leafOk || root === null) unboundKeys.add(a._sourceKey);
  }
  for (const _k of unboundKeys) diagnostics.push("PROVENANCE_UNBOUND");
  let status;
  if (teachable.length === 0) {
    status = "PARTIAL";
    diagnostics.push("INSUFFICIENT_EVIDENCE");
  } else if (quizzes.length > 0) {
    status = gaps.length > 0 ? "PARTIAL" : "REPORT_READY";
  } else {
    status = "PARTIAL";
    diagnostics.push("INSUFFICIENT_EVIDENCE");
  }
  return {
    status,
    quizzes,
    composites,
    gaps,
    rejected_codes: rejected,
    contradictions: contradictions.sort(),
    quarantined: qList(),
    diagnostics: diagnostics.sort(),
  };
}

export { canon, byteLen };
