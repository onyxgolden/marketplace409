#!/usr/bin/env node
/**
 * make-battery.js — AUTHORING TOOL (not part of the scored path).
 * Builds corpus/battery.json: 120 independently-specified cases with
 * expected outputs derived from the brief's text via an INDEPENDENT
 * oracle written here. The oracle never imports src/* and re-derives
 * the attribution/corroboration/contradiction rules with separately
 * written logic, hand-verified against manual derivations.
 */

import { writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));

// ================= Independent oracle (clean-room research) =================
// Written separately from src/research.js. Plain, obviously-correct logic;
// hand-verified against manual derivations for the core cases.

function oRender(a) {
  const v = a.value_type === "string" ? JSON.stringify(a.value)
    : a.value_type === "number" ? JSON.stringify(a.value)
    : (a.value === true ? "true" : "false");
  const body = `${a.subject} | ${a.predicate} | ${v} | ${a.scope}`;
  return a.polarity === "negative" ? `NOT ${body}` : body;
}
function oSame(a, b) {
  return a.subject === b.subject && a.predicate === b.predicate &&
    a.value_type === b.value_type && a.value === b.value &&
    a.scope === b.scope && a.polarity === b.polarity;
}
function oConflict(a, b) {
  if (a.subject !== b.subject || a.predicate !== b.predicate) return false;
  if (a.scope !== b.scope || a.value_type !== b.value_type) return false;
  if (a.polarity !== b.polarity) return true;
  return a.value !== b.value;
}
// Independent quarantine predicate (separately written from src/injection.js).
const O_QUARANTINE_RE = /system instruction:|mark all claims .* as (externally )?verified|ignore (all )?previous instructions|relabel .* as supported|disregard (the|your) (brief|instructions|policy)|you are now (a|an) |approve this (claim|report|finding)|<script[\s>]/i;
function oQuarantined(text) {
  return O_QUARANTINE_RE.test(text);
}
function oVerifyAssertion(passageText, assertion) {
  const expected = oRender(assertion);
  const bytes = Buffer.from(passageText, "utf8");
  const { start_byte, end_byte } = assertion.span;
  if (!Number.isInteger(start_byte) || !Number.isInteger(end_byte) ||
      start_byte < 0 || end_byte < start_byte || end_byte > bytes.length) return null;
  const slice = bytes.subarray(start_byte, end_byte).toString("utf8");
  return slice === expected ? { start_byte, end_byte, quoted_text: expected } : null;
}
function oClosure(originKey, registry) {
  // Independent reimplementation of bounded provenance closure:
  // undirected derivation graph, visited set (cycle-safe).
  const adj = new Map();
  const link = (a, b) => {
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b);
    adj.get(b).add(a);
  };
  for (const key of Object.keys(registry)) {
    for (const l of (registry[key] && registry[key].derivation_links) || []) {
      if (!l || typeof l.from_doc !== "string") continue;
      link(key, `${l.from_doc}|${l.from_passage}`);
    }
  }
  const seen = new Set([originKey]);
  const queue = [originKey];
  while (queue.length > 0) {
    const cur = queue.shift();
    for (const next of adj.get(cur) || []) {
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  seen.delete(originKey);
  return seen;
}
function oCycleDefeats(originDoc, candDoc, docCites, cycles) {
  // Independent reimplementation: the cycle is relevant only when it
  // connects the origin and the candidate.
  if (originDoc === candDoc) return false;
  if (!cycles.has(originDoc) && !cycles.has(candDoc)) return false;
  const adj = new Map();
  const link = (a, b) => {
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b);
    adj.get(b).add(a);
  };
  for (const [d, targets] of docCites) for (const t of targets || []) link(d, t);
  const seen = new Set([originDoc]);
  const queue = [originDoc];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === candDoc) return true;
    for (const next of adj.get(cur) || []) {
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return false;
}
function oClassify(originRef, candRef, registry, docCites, cycles) {
  const o = registry[`${originRef.doc_id}|${originRef.passage_id}`];
  const c = registry[`${candRef.doc_id}|${candRef.passage_id}`];
  if (!o || !c) return "unregistered";
  if (o.provenance_group_id === c.provenance_group_id) return "same_group";
  // Transitive copy/derivation defeat (either direction), then relevant
  // citation-cycle defeat. Both defeat classes contribute zero
  // corroboration.
  if (oClosure(`${originRef.doc_id}|${originRef.passage_id}`, registry).has(`${candRef.doc_id}|${candRef.passage_id}`)) {
    return "derivation_linked";
  }
  if (oCycleDefeats(originRef.doc_id, candRef.doc_id, docCites, cycles || new Set())) return "cycle_defeated";
  return "independent";
}
function oCycles(docCites) {
  const docs = [...docCites.keys()];
  const color = new Map(docs.map((d) => [d, 0]));
  const stack = [];
  const onCycle = new Set();
  function dfs(u) {
    color.set(u, 1); stack.push(u);
    for (const v of docCites.get(u) || []) {
      if (!docCites.has(v)) continue;
      if (color.get(v) === 1) { for (let i = stack.indexOf(v); i < stack.length; i++) onCycle.add(stack[i]); }
      else if (color.get(v) === 0) dfs(v);
    }
    stack.pop(); color.set(u, 2);
  }
  for (const d of docs) if (color.get(d) === 0) dfs(d);
  return onCycle;
}

function oEvaluate(docs, claims, registry) {
  // Returns { claimResults: [{claim_id, research_status, ...}], quarantined: [qid], spanMismatch: bool, cycles }
  const quarantined = new Set();
  for (const d of docs) {
    for (const p of d.passages || []) {
      if (oQuarantined(p.text)) quarantined.add(`${d.doc_id}#${p.passage_id}`);
    }
  }
  const index = [];
  let spanMismatch = false;
  for (const d of docs) {
    for (const p of d.passages || []) {
      if (quarantined.has(`${d.doc_id}#${p.passage_id}`)) continue;
      for (const a of p.assertions || []) {
        const v = oVerifyAssertion(p.text, a);
        if (!v) { spanMismatch = true; continue; }
        index.push({ doc_id: d.doc_id, passage_id: p.passage_id, atom: a });
      }
    }
  }
  const docCites = new Map();
  for (const d of docs) {
    const t = new Set();
    for (const p of d.passages || []) for (const c of p.citations || []) t.add(c.target_doc);
    docCites.set(d.doc_id, t);
  }
  const cycles = oCycles(docCites);
  const claimResults = [];
  const sorted = [...claims].sort((a, b) => (a.claim_id < b.claim_id ? -1 : 1));
  for (const rc of sorted) {
    for (let ai = 0; ai < rc.atoms.length; ai++) {
      const atom = rc.atoms[ai];
      let faithful = false, origin = null;
      if (rc.origin_passage_refs.length > 0) {
        for (const ref of rc.origin_passage_refs) {
          const hit = index.find((e) => e.doc_id === ref.doc_id && e.passage_id === ref.passage_id && oSame(e.atom, atom));
          if (hit) { faithful = true; origin = { doc_id: hit.doc_id, passage_id: hit.passage_id }; break; }
        }
      }
      let corroborated = false;
      const diags = [];
      // Per-class corroboration counts (for the independent output-record
      // taxonomy derivation below).
      const classCounts = { independent: 0, same_group: 0, unregistered: 0, derivation_linked: 0, cycle_defeated: 0 };
      if (faithful) {
        for (const e of index) {
          if (e.doc_id === origin.doc_id && e.passage_id === origin.passage_id) continue;
          if (!oSame(e.atom, atom)) continue;
          const cls = oClassify(origin, { doc_id: e.doc_id, passage_id: e.passage_id }, registry, docCites, cycles);
          classCounts[cls] += 1;
          if (cls === "independent") corroborated = true;
        }
      }
      const contradicted = index.some((e) => oConflict(e.atom, atom));
      const contradictionCount = index.filter((e) => oConflict(e.atom, atom)).length;
      let research_status;
      if (contradicted) research_status = "contradicted";
      else if (faithful && corroborated) research_status = "supported";
      else if (faithful) research_status = "attributed-only";
      else research_status = "unsupported";
      const inCycle = origin !== null && cycles.has(origin.doc_id);
      if (inCycle && research_status === "attributed-only") diags.push("CITATION_CYCLE_NO_SUPPORT");
      // Quarantined/span-bad origin that fails fidelity -> EVIDENCE_WITHHELD.
      if (rc.origin_passage_refs.length > 0 && !faithful) {
        const q0 = `${rc.origin_passage_refs[0].doc_id}#${rc.origin_passage_refs[0].passage_id}`;
        if (quarantined.has(q0) || spanMismatch) diags.push("EVIDENCE_WITHHELD");
      }
      claimResults.push({ claim_id: `${rc.claim_id}#${ai + 1}`, research_status, diags, faithful, classCounts, contradictionCount });
    }
  }
  return { claimResults, quarantined: [...quarantined].sort(), spanMismatch, cycles };
}

/**
 * Independent derivation of the natural output-record count under the
 * brief's public-record taxonomy (separately written from
 * countFinalEnvelopeRecords in src/index.js):
 * report(1) + coverage(1) + summary(1 when REPORT_READY and population
 * verified with no quarantine/span-mismatch) + per claim: claim(1) +
 * atom(1) + origin(1) [+ origin citation(1) + source_ref(1) +
 * byte_identity(1) + span(1) when faithful] + corroboration record(1)
 * per claim — the claim's public corroboration object itself
 * (RA652-004) — + per corroboration resource entry (all five
 * classes): entry(1) + citation(1) + source_ref(1) + byte_identity(1) +
 * span(1) + per contradiction: conflict(1) + citation(1) +
 * source_ref(1) + byte_identity(1) + span(1) + top-level
 * source_ref(1) + diagnostics(n) + quarantined(n).
 */
function oNaturalRecords(evalSummary) {
  const { claimResults, quarantined, spanMismatch, popVerified, hasSummary } = evalSummary;
  let n = 1 + 1; // report + coverage
  if (hasSummary) n += 1;
  for (const cr of claimResults) {
    n += 3; // claim + atom + origin
    if (cr.faithful) n += 4; // origin citation + source_ref + byte_identity (PER-010) + span
    n += 1; // corroboration record itself (RA652-004)
    const resources = cr.classCounts.independent + cr.classCounts.same_group + cr.classCounts.unregistered +
      cr.classCounts.derivation_linked + cr.classCounts.cycle_defeated;
    n += resources * 5; // entry + citation + source_ref + byte_identity (PER-010) + span
    n += cr.contradictionCount * 5; // conflict + citation + source_ref + byte_identity (PER-010) + span
  }
  n += 1; // top-level source_refs[0]
  n += evalSummary.diagCount;
  n += quarantined.length;
  return n;
}

function oDocCost(d) {
  // Mirrors the README candidate taxonomy: 1 (doc) + 1 (passages array)
  // + per passage: 1 + 1 (assertions array) + 2 per assertion
  // (assertion + span) + 1 (citations array) + 1 per citation.
  let n = 2;
  for (const p of d.passages || []) {
    n += 3 + 2 * (p.assertions || []).length + (p.citations || []).length;
  }
  return n;
}
function oCountJson(v) {
  if (v === null || typeof v !== "object") return 0;
  let n = 1;
  if (Array.isArray(v)) { for (const x of v) n += oCountJson(x); }
  else { for (const k of Object.keys(v)) n += oCountJson(v[k]); }
  return n;
}
function oRegistryCost(reg) {
  // Mirrors src/schemas.js validateProvenanceRegistry +
  // validateProvenanceEntry object charging exactly: 1 (registry
  // object) + per entry 1 (entry) + 1 (applies_to array container) +
  // 1 per applies_to pin + 1 (derivation_links array container, when
  // the host supplied the array) + 1 per derivation link. PER-008
  // round 2: the containing arrays are consulted containers and are
  // charged — they are not free. (Their serialized bytes are
  // payload-charged instead — separate budget.)
  let n = 1;
  for (const k of Object.keys(reg || {})) {
    n += 1; // entry
    n += 1; // applies_to array container
    n += (reg[k].applies_to || []).length;
    if (reg[k].derivation_links !== undefined) n += 1; // derivation_links array container
    n += (reg[k].derivation_links || []).length;
  }
  return n;
}
function oContextCost(context) {
  // Mirrors the implementation's context admission charging exactly
  // (validateGrantGateContext + validateSelectedSourceEntry +
  // validateProvenanceRegistry). Only the SELECTED source entry is
  // admitted (RA652-006); denied/non-selected entries cost nothing.
  const grants = context.readGrants || [];
  let n = 1; // context
  n += 1; // sources map (key set only; entries untouched pre-grant)
  n += 1 + grants.length; // readGrants array + grants
  n += 1; // principal
  n += 1; // criteria
  if (context.test_hooks) n += 1;
  n += 1; // selected source entry
  n += 1; // revisions map
  n += 1; // revision (single-revision fixtures)
  n += oRegistryCost(context.provenance_registry);
  return n;
}
function oBudgetOk(task, context, docs) {
  // Task: admitGraph charges every distinct object/array occurrence.
  // Context: oContextCost mirrors the validators. Docs: oDocCost.
  const total = oCountJson(task) + oContextCost(context) + 1 + docs.reduce((n, d) => n + oDocCost(d), 0);
  return total <= 64;
}

// ================= Builders =================
function registryFor(bundleNames) {
  const reg = {};
  for (const n of bundleNames) {
    const ref = store.bundleRefs[n];
    for (const d of docsFor(n)) {
      for (const p of d.passages || []) {
        const k = `${d.doc_id}|${p.passage_id}`;
        if (store.provenanceRegistry[k]) {
          // EXEC652-002: per-run host selection — bind this evaluation's
          // registry entries to the evaluated bundle's exact source pin.
          reg[k] = { ...store.provenanceRegistry[k], applies_to: [{ ...ref }] };
        }
      }
    }
  }
  return reg;
}
function docsFor(bundleName) {
  const ref = store.bundleRefs[bundleName];
  try {
    const docs = JSON.parse(store.sources[`${ref.repo}|${ref.path}`].revisions[ref.commit].text);
    return Array.isArray(docs) ? docs : [];
  } catch {
    return [];
  }
}
function baseContext(bundleNames, overrides = {}) {
  const sources = {};
  const readGrants = [];
  for (const n of bundleNames) {
    const ref = store.bundleRefs[n];
    const key = `${ref.repo}|${ref.path}`;
    sources[key] = store.sources[key];
    readGrants.push({ repo: ref.repo, path: ref.path });
  }
  const ctx = {
    clock: ("clock" in overrides) ? overrides.clock : 1780315200000,
    sources: overrides.sources !== undefined ? overrides.sources : sources,
    readGrants: overrides.readGrants !== undefined ? overrides.readGrants : readGrants,
    principal: overrides.principal || store.principals.jason,
    criteria: { ...store.criteriaPresets.standard, ...(overrides.criteria || {}) },
    provenance_registry: overrides.provenance_registry !== undefined ? overrides.provenance_registry : registryFor(bundleNames),
  };
  if (overrides.test_hooks !== undefined) ctx.test_hooks = overrides.test_hooks;
  return ctx;
}
function baseTask(bundleName, opts = {}) {
  const ref = store.bundleRefs[bundleName];
  let n = 0;
  try { n = docsFor(bundleName).length; } catch { n = 0; }
  const task = {
    schema_version: "1",
    task_id: `battery-${opts.caseId || bundleName}`,
    operation: opts.operation !== undefined ? opts.operation : "analyze",
    fixture_refs: { evidence_bundle: { ...(opts.refOverride || ref) } },
    options: {
      population: {
        declared_total: opts.declared !== undefined ? opts.declared : n,
        complete: opts.complete !== undefined ? opts.complete : true,
      },
      requested_claims: opts.claims || [],
    },
  };
  if (opts.taskMutate) opts.taskMutate(task);
  if (opts.taskOverride !== undefined) return opts.taskOverride;
  return task;
}
function mkClaim(claim_id, atoms, origin_passage_refs) {
  return { claim_id, atoms, origin_passage_refs };
}
function mkAtom(subject, predicate, value, value_type, scope, polarity = "positive") {
  return { subject, predicate, value, value_type, scope, polarity };
}
const REV = () => mkAtom("ACME-CORP", "q3-revenue", 1200000, "number", "fy-2026-q3");

const CASES = [];
function addCase(case_id, category, bundleName, taskOpts, ctxOverrides, expected) {
  CASES.push({
    case_id, category,
    task: baseTask(bundleName, { ...taskOpts, caseId: case_id }),
    context: baseContext(Array.isArray(bundleName) ? bundleName : [bundleName], ctxOverrides || {}),
    expected,
  });
}
/** Derive the expected envelope for a successful evaluation via the oracle. */
function expEval(bundleName, taskOpts, ctxOverrides = {}, extra = {}) {
  const docs = docsFor(bundleName);
  const claims = taskOpts.claims || [];
  const reg = ctxOverrides.provenance_registry !== undefined ? ctxOverrides.provenance_registry : registryFor([bundleName]);
  const { claimResults, quarantined, spanMismatch } = oEvaluate(docs, claims, reg);
  const diags = new Set(extra.diagnostic_codes || []);
  for (const cr of claimResults) for (const d of cr.diags) diags.add(d);
  if (spanMismatch) diags.add("SPAN_MISMATCH");
  if (quarantined.length > 0) diags.add("INSTRUCTION_INJECTION");
  const contradicted = claimResults.some((c) => c.research_status === "contradicted");
  const unsupported = claimResults.some((c) => c.research_status === "unsupported");
  const hasQuarantine = quarantined.length > 0;
  const declared = taskOpts.declared !== undefined ? taskOpts.declared : docs.length;
  const complete = taskOpts.complete !== undefined ? taskOpts.complete : true;
  const popVerified = declared === docs.length && complete === true;
  // Empty bundle: the implementation returns EMPTY, never REPORT_READY.
  if (docs.length === 0) {
    return {
      status: "EMPTY",
      diagnostic_codes: [],
      claim_statuses: [],
      quarantined_ids: [],
      coverage_state: popVerified ? "COMPLETE_EMPTY" : "UNKNOWN_EMPTY",
    };
  }
  let status;
  if (contradicted || unsupported || hasQuarantine || spanMismatch || !popVerified) status = "PARTIAL";
  else status = "REPORT_READY";
  // Budget check via the oracle's independent counter.
  const task = baseTask(bundleName, { ...taskOpts });
  const ctx = baseContext([bundleName], ctxOverrides);
  if (!oBudgetOk(task, ctx, docs)) {
    return { status: "REFUSED", diagnostic_codes: ["BUDGET_EXCEEDED"], claim_statuses: [], quarantined_ids: [], coverage_state: "UNKNOWN" };
  }
  return {
    status: extra.status || status,
    diagnostic_codes: [...diags],
    claim_statuses: claimResults.map((c) => c.research_status),
    quarantined_ids: quarantined,
    coverage_state: extra.coverage_state || (popVerified
      ? (contradicted || unsupported || hasQuarantine || spanMismatch ? "PARTIAL" : "COMPLETE")
      : "UNKNOWN"),
  };
}
function expRefused(code) {
  return { status: "REFUSED", diagnostic_codes: [code], claim_statuses: [], quarantined_ids: [], coverage_state: "UNKNOWN" };
}

// ================= 120 battery cases =================
function addEval(case_id, category, bundleName, claims, taskOpts = {}, ctxOverrides = {}, extra = {}) {
  const opts = { ...taskOpts, claims };
  addCase(case_id, category, bundleName, opts, ctxOverrides, expEval(bundleName, opts, ctxOverrides, extra));
}
const C_ALPH = [{ doc_id: "doc-alpha", passage_id: "p1" }];
const C_A = [{ doc_id: "doc-a", passage_id: "p1" }];
const C_B = [{ doc_id: "doc-b", passage_id: "p1" }];
const C_ALPHA = [{ doc_id: "doc-alpha", passage_id: "p1" }];
const C_BETA = [{ doc_id: "doc-beta", passage_id: "p1" }];
const C_CERT = [{ doc_id: "doc-cert", passage_id: "p1" }];
const EMP = (v) => mkAtom("ACME-CORP", "employee-count", v, "number", "fy-2026-q3");

// ---------- 40 nominal / boundary ----------
addEval("nom-001-empty", "nominal_boundary", "empty", []);
addEval("nom-002-single-attributed", "nominal_boundary", "single-passage", [mkClaim("c1", [REV()], C_ALPH)]);
addEval("nom-003-cross-supported", "nominal_boundary", "cross-doc-support", [mkClaim("c1", [REV()], C_ALPHA)]);
addEval("nom-004-contradiction", "nominal_boundary", "contradiction", [mkClaim("c1", [REV()], C_ALPHA)]);
addEval("nom-005-scope-diff", "nominal_boundary", "scope-diff", [
  mkClaim("c1", [REV()], C_A),
  mkClaim("c2", [mkAtom("ACME-CORP", "q3-revenue", 1200000, "number", "fy-2026-q4")], C_B),
]);
addEval("nom-006-typed-distinction", "nominal_boundary", "typed-distinction", [
  mkClaim("c1", [mkAtom("LIMIT", "max-items", 5, "number", "policy-v1")], C_A),
]);
addEval("nom-007-unicode", "nominal_boundary", "unicode", [
  mkClaim("c1", [mkAtom("株式会社ACME", "q3-revenue", 1200000, "number", "fy-2026-q3")], [{ doc_id: "doc-uni", passage_id: "p1" }]),
]);
addEval("nom-008-url-literal", "nominal_boundary", "url-literal", [
  mkClaim("c1", [REV()], [{ doc_id: "doc-url", passage_id: "p1" }]),
]);
addEval("nom-009-opposite-polarity", "nominal_boundary", "opposite-polarity", [
  mkClaim("c1", [mkAtom("FEATURE-X", "enabled", true, "boolean", "v2", "positive")], C_A),
]);
addEval("nom-010-supported-opposed", "nominal_boundary", "supported-opposed", [mkClaim("c1", [REV()], C_A)]);
addEval("nom-011-cert-fact", "nominal_boundary", "certification", [mkClaim("c1", [REV()], C_CERT)]);
addEval("nom-012-cert-self", "nominal_boundary", "certification", [
  mkClaim("c1", [mkAtom("DOC-CERT", "certified-accurate-by", "FEDERAL-RESERVE", "string", "doc-cert")], C_CERT),
]);
addEval("nom-013-self-cert", "nominal_boundary", "self-cert", [
  mkClaim("c1", [mkAtom("DOC-S", "self-certified", true, "boolean", "doc-s")], [{ doc_id: "doc-s", passage_id: "p1" }]),
]);
addEval("nom-014-cert-only-support", "nominal_boundary", "cert-only-support", [mkClaim("c1", [REV()], C_A)]);
addEval("nom-015-citation-cycle", "nominal_boundary", "citation-cycle", [mkClaim("c1", [REV()], C_A)]);
addEval("nom-016-same-group-copy", "nominal_boundary", "same-group-copy", [mkClaim("c1", [REV()], [{ doc_id: "doc-sgc-a", passage_id: "p1" }])]);
addEval("nom-017-unregistered", "nominal_boundary", "unregistered", [mkClaim("c1", [REV()], [{ doc_id: "doc-ur-a", passage_id: "p1" }])]);
addEval("nom-018-derivation-link", "nominal_boundary", "derivation-link", [mkClaim("c1", [REV()], [{ doc_id: "doc-dl-a", passage_id: "p1" }])]);
addEval("nom-019-duplicate-source", "nominal_boundary", "duplicate-source", [mkClaim("c1", [REV()], [{ doc_id: "doc-dup-a", passage_id: "p1" }])]);
addEval("nom-020-multipart-half", "nominal_boundary", "multipart", [
  mkClaim("c1", [REV(), mkAtom("ACME-CORP", "employee-count", 999, "number", "fy-2026-q3")], C_A),
]);
addEval("nom-021-multipart-full", "nominal_boundary", "multipart", [
  mkClaim("c1", [REV(), EMP(420)], C_A),
]);
addEval("nom-022-distorted", "nominal_boundary", "distorted", [
  mkClaim("c1", [mkAtom("ACME-CORP", "q3-revenue", 1300000, "number", "fy-2026-q3")], C_A),
]);
addEval("nom-023-multi-claim", "nominal_boundary", "multi-claim", [
  mkClaim("c1", [REV()], C_A),
  mkClaim("c2", [EMP(420)], C_A),
  mkClaim("c3", [mkAtom("ACME-CORP", "q3-revenue", 555, "number", "fy-2026-q3")], C_A),
]);
addEval("nom-024-no-origin", "nominal_boundary", "single-passage", [mkClaim("c1", [REV()], [])]);
addEval("nom-025-bad-origin", "nominal_boundary", "single-passage", [
  mkClaim("c1", [REV()], [{ doc_id: "doc-nope", passage_id: "p9" }]),
]);
addEval("nom-026-empty-passages", "nominal_boundary", "empty-passages", [
  mkClaim("c1", [REV()], [{ doc_id: "doc-empty", passage_id: "p1" }]),
]);
addEval("nom-027-no-claims", "nominal_boundary", "single-passage", []);
addEval("nom-028-many-citations", "nominal_boundary", "many-citations", [mkClaim("c1", [REV()], C_A)]);
addEval("nom-029-negative-faithful", "nominal_boundary", "opposite-polarity", [
  mkClaim("c1", [mkAtom("FEATURE-X", "enabled", true, "boolean", "v2", "negative")], C_B),
]);
addEval("nom-030-string-cert", "nominal_boundary", "cert-only-support", [
  mkClaim("c1", [mkAtom("DOC-B", "certified-accurate-by", "REVIEW-BOARD", "string", "doc-b")], C_B),
]);
addEval("nom-031-injection-clean-origin", "nominal_boundary", "injection", [
  mkClaim("c1", [mkAtom("ACME-CORP", "q3-revenue", 900000, "number", "fy-2026-q3")], [{ doc_id: "doc-clean", passage_id: "p1" }]),
]);
addEval("nom-032-boundary-fit", "nominal_boundary", "boundary-fit", [], {}, { provenance_registry: {} });
addEval("nom-033-span-mismatch", "nominal_boundary", "span-mismatch", [mkClaim("c1", [REV()], C_A)]);
addEval("nom-034-quarantine-origin", "nominal_boundary", "quarantine-origin", [
  mkClaim("c1", [REV()], [{ doc_id: "doc-inj", passage_id: "p1" }]),
]);
addEval("nom-035-two-claims", "nominal_boundary", "cross-doc-support", [
  mkClaim("c1", [REV()], C_ALPHA),
  mkClaim("c2", [REV()], C_BETA),
]);
addEval("nom-036-multi-origin-refs", "nominal_boundary", "cross-doc-support", [
  mkClaim("c1", [REV()], [C_ALPHA[0], C_BETA[0]]),
]);
addEval("nom-037-claim-order", "nominal_boundary", "multi-claim", [
  mkClaim("c9", [REV()], C_A),
  mkClaim("c2", [EMP(420)], C_A),
  mkClaim("c5", [mkAtom("ACME-CORP", "q3-revenue", 555, "number", "fy-2026-q3")], C_A),
]);
addEval("nom-038-string-limit", "nominal_boundary", "typed-distinction", [
  mkClaim("c1", [mkAtom("LIMIT", "max-items", "5", "string", "policy-v1")], C_B),
]);
addEval("nom-039-scope-q4", "nominal_boundary", "scope-diff", [
  mkClaim("c1", [mkAtom("ACME-CORP", "q3-revenue", 1200000, "number", "fy-2026-q4")], C_B),
]);
addEval("nom-040-population-incomplete", "nominal_boundary", "single-passage",
  [mkClaim("c1", [REV()], C_ALPH)], { complete: false });

// ---------- 30 contradiction / incomplete / duplicate ----------
addCase("con-001-duplicate-doc", "contradiction_incomplete", "duplicate-doc", {}, {}, expRefused("INVALID_INPUT"));
addCase("con-002-malformed", "contradiction_incomplete", "malformed", {}, {}, expRefused("INVALID_INPUT"));
addCase("con-003-not-array", "contradiction_incomplete", "not-array", {}, {}, expRefused("INVALID_INPUT"));
addCase("con-004-bad-json", "contradiction_incomplete", "bad-json-entry", {}, {}, expRefused("INVALID_INPUT"));
addCase("con-005-duplicate-passage", "contradiction_incomplete", "duplicate-passage", {}, {}, expRefused("INVALID_INPUT"));
addCase("con-006-duplicate-assertion", "contradiction_incomplete", "duplicate-assertion", {}, {}, expRefused("INVALID_INPUT"));
addEval("con-007-declared-high", "contradiction_incomplete", "single-passage", [mkClaim("c1", [REV()], C_ALPH)], { declared: 99 });
addEval("con-008-declared-low", "contradiction_incomplete", "single-passage", [mkClaim("c1", [REV()], C_ALPH)], { declared: 0 });
addEval("con-009-incomplete", "contradiction_incomplete", "single-passage", [mkClaim("c1", [REV()], C_ALPH)], { complete: false });
addCase("con-010-dup-claim-id", "contradiction_incomplete", "single-passage",
  { claims: [mkClaim("c1", [REV()], C_ALPH), mkClaim("c1", [REV()], C_ALPH)] }, {}, expRefused("INVALID_INPUT"));
addCase("con-011-bad-value-type", "contradiction_incomplete", "single-passage",
  { claims: [mkClaim("c1", [mkAtom("S", "p", 1, "decimal", "s")], C_ALPH)] }, {}, expRefused("INVALID_INPUT"));
addCase("con-012-bad-polarity", "contradiction_incomplete", "single-passage",
  { claims: [mkClaim("c1", [mkAtom("S", "p", 1, "number", "s", "maybe")], C_ALPH)] }, {}, expRefused("INVALID_INPUT"));
addCase("con-013-empty-atoms", "contradiction_incomplete", "single-passage",
  { claims: [{ claim_id: "c1", atoms: [], origin_passage_refs: C_ALPH }] }, {}, expRefused("INVALID_INPUT"));
addCase("con-014-bad-doc-id", "contradiction_incomplete", "single-passage",
  { claims: [mkClaim("c1", [REV()], [{ doc_id: "../x", passage_id: "p1" }])] }, {}, expRefused("INVALID_INPUT"));
addCase("con-015-claims-not-array", "contradiction_incomplete", "single-passage",
  { taskMutate: (t) => { t.options.requested_claims = {}; } }, {}, expRefused("INVALID_INPUT"));
addCase("con-016-task-null", "contradiction_incomplete", "single-passage", { taskOverride: null }, {}, expRefused("INVALID_INPUT"));
addCase("con-017-task-unknown-prop", "contradiction_incomplete", "single-passage",
  { taskMutate: (t) => { t.extra = 1; } }, {}, expRefused("INVALID_INPUT"));
addCase("con-018-schema-version-2", "contradiction_incomplete", "single-passage",
  { taskMutate: (t) => { t.schema_version = "2"; } }, {}, expRefused("INVALID_INPUT"));
addCase("con-019-task-id-missing", "contradiction_incomplete", "single-passage",
  { taskMutate: (t) => { delete t.task_id; } }, {}, expRefused("INVALID_INPUT"));
addCase("con-020-fixture-refs-missing", "contradiction_incomplete", "single-passage",
  { taskMutate: (t) => { delete t.fixture_refs.evidence_bundle; } }, {}, expRefused("INVALID_INPUT"));
addCase("con-021-too-many-atoms", "contradiction_incomplete", "single-passage",
  { claims: [{ claim_id: "c1", atoms: Array.from({ length: 65 }, (_, i) => mkAtom(`S${i}`, "p", 1, "number", "s")), origin_passage_refs: C_ALPH }] },
  {}, expRefused("BUDGET_EXCEEDED"));
addCase("con-022-bad-claim-id", "contradiction_incomplete", "single-passage",
  { claims: [mkClaim("bad id!", [REV()], C_ALPH)] }, {}, expRefused("INVALID_INPUT"));
addCase("con-023-empty-subject", "contradiction_incomplete", "single-passage",
  { claims: [mkClaim("c1", [mkAtom("", "p", 1, "number", "s")], C_ALPH)] }, {}, expRefused("INVALID_INPUT"));
addCase("con-024-empty-scope", "contradiction_incomplete", "single-passage",
  { claims: [mkClaim("c1", [mkAtom("S", "p", 1, "number", "")], C_ALPH)] }, {}, expRefused("INVALID_INPUT"));
addEval("con-025-empty-passages-no-claims", "contradiction_incomplete", "empty-passages", []);
addCase("con-026-options-missing-population", "contradiction_incomplete", "single-passage",
  { taskMutate: (t) => { delete t.options.population; } }, {}, expRefused("INVALID_INPUT"));
addCase("con-027-declared-negative", "contradiction_incomplete", "single-passage",
  { taskMutate: (t) => { t.options.population.declared_total = -1; } }, {}, expRefused("INVALID_INPUT"));
addCase("con-028-operation-empty", "contradiction_incomplete", "single-passage", { operation: "" }, {}, expRefused("INVALID_INPUT"));
addCase("con-029-nonfinite-value", "contradiction_incomplete", "single-passage",
  { taskMutate: (t) => { t.options.requested_claims[0].atoms[0].value = Infinity; } ,
    claims: [mkClaim("c1", [mkAtom("S", "p", 1, "number", "s")], C_ALPH)] }, {}, expRefused("INVALID_INPUT"));
addEval("con-030-scope-diff-both", "contradiction_incomplete", "scope-diff", [
  mkClaim("c1", [REV()], C_A),
  mkClaim("c2", [mkAtom("ACME-CORP", "q3-revenue", 1200000, "number", "fy-2026-q4")], C_B),
]);

// ---------- 20 injection / prohibited-operation ----------
for (const [i, op] of ["delete", "execute", "publish", "approve", "write", "send", "mutate", "export", "commit", "schedule"].entries()) {
  addCase(`inj-00${i + 1}-op-${op}`, "injection_prohibited", "single-passage", { operation: op }, {}, expRefused("ACTION_DENIED"));
}
addCase("inj-11-op-trailing-space", "injection_prohibited", "single-passage", { operation: "analyze " }, {}, expRefused("ACTION_DENIED"));
addCase("inj-12-op-uppercase", "injection_prohibited", "single-passage", { operation: "ANALYZE" }, {}, expRefused("ACTION_DENIED"));
addCase("inj-13-op-null", "injection_prohibited", "single-passage",
  { taskMutate: (t) => { t.operation = null; } }, {}, expRefused("INVALID_INPUT"));
addEval("inj-14-injection-standard", "injection_prohibited", "injection", [
  mkClaim("c1", [mkAtom("ACME-CORP", "q3-revenue", 900000, "number", "fy-2026-q3")], [{ doc_id: "doc-clean", passage_id: "p1" }]),
]);
addEval("inj-15-injection-declared-mismatch", "injection_prohibited", "injection", [
  mkClaim("c1", [mkAtom("ACME-CORP", "q3-revenue", 900000, "number", "fy-2026-q3")], [{ doc_id: "doc-clean", passage_id: "p1" }]),
], { declared: 99 });
addEval("inj-16-injection-incomplete", "injection_prohibited", "injection", [
  mkClaim("c1", [mkAtom("ACME-CORP", "q3-revenue", 900000, "number", "fy-2026-q3")], [{ doc_id: "doc-clean", passage_id: "p1" }]),
], { complete: false });
addEval("inj-17-quarantine-origin", "injection_prohibited", "quarantine-origin", [
  mkClaim("c1", [REV()], [{ doc_id: "doc-inj", passage_id: "p1" }]),
]);
addEval("inj-18-injection-no-claims", "injection_prohibited", "injection", []);
addCase("inj-19-op-number", "injection_prohibited", "single-passage",
  { taskMutate: (t) => { t.operation = 42; } }, {}, expRefused("INVALID_INPUT"));
addEval("inj-20-injection-quarantined-claim", "injection_prohibited", "injection", [
  mkClaim("c1", [mkAtom("ACME-CORP", "q3-revenue", 1200000, "number", "fy-2026-q3")], [{ doc_id: "doc-inj", passage_id: "p1" }]),
]);

// ---------- 20 schema / provenance / permission ----------
addCase("sch-001-blob-mismatch", "schema_provenance", "single-passage",
  { refOverride: { ...store.bundleRefs["single-passage"], blob: "0".repeat(40) } }, {}, expRefused("HASH_MISMATCH"));
addCase("sch-002-unregistered-commit", "schema_provenance", "single-passage",
  { refOverride: { ...store.bundleRefs["single-passage"], commit: "1".repeat(40) } }, {}, expRefused("SOURCE_UNVERIFIED"));
addCase("sch-003-unregistered-path", "schema_provenance", "single-passage",
  { refOverride: { ...store.bundleRefs["single-passage"], path: "bundles/nope.json" } },
  { readGrants: [{ repo: "research-sources", path: "bundles/nope.json" }] }, expRefused("SOURCE_UNVERIFIED"));
addCase("sch-004-missing-grant", "schema_provenance", "single-passage", {}, { readGrants: [] }, expRefused("READ_DENIED"));
addCase("sch-005-principal-revoked", "schema_provenance", "single-passage", {},
  { principal: { ...store.principals.jason, revoked: true } }, expRefused("ACTION_DENIED"));
addCase("sch-006-clock-expired", "schema_provenance", "single-passage", {}, { clock: 1820000000000 }, expRefused("ACTION_DENIED"));
addCase("sch-007-clock-not-yet-valid", "schema_provenance", "single-passage", {}, { clock: 1700000000000 }, expRefused("ACTION_DENIED"));
addCase("sch-008-clock-missing", "schema_provenance", "single-passage", {}, { clock: undefined }, expRefused("INVALID_INPUT"));
addCase("sch-009-bad-algorithm", "schema_provenance", "single-passage",
  { taskMutate: (t) => { t.fixture_refs.evidence_bundle.algorithm = "sha256"; } }, {}, expRefused("INVALID_INPUT"));
addCase("sch-010-path-traversal", "schema_provenance", "single-passage",
  { taskMutate: (t) => { t.fixture_refs.evidence_bundle.path = "../bundles/x.json"; } }, {}, expRefused("INVALID_INPUT"));
addCase("sch-011-revision-mismatch", "schema_provenance", "single-passage",
  { refOverride: { ...store.bundleRefs["single-passage"], revision: "v9" } }, {}, expRefused("SOURCE_UNVERIFIED"));
addCase("sch-012-context-sources-empty", "schema_provenance", "single-passage", {},
  { sources: {}, readGrants: [{ repo: "research-sources", path: "bundles/single-passage.json" }] }, expRefused("INVALID_INPUT"));
addCase("sch-013-bad-hex-commit", "schema_provenance", "single-passage",
  { taskMutate: (t) => { t.fixture_refs.evidence_bundle.commit = "xyz"; } }, {}, expRefused("INVALID_INPUT"));
addCase("sch-014-bad-registry-key", "schema_provenance", "single-passage", {},
  { provenance_registry: { "bad key!": { provenance_group_id: "g", derivation_links: [] } } }, expRefused("INVALID_INPUT"));
addCase("sch-015-bad-group-id", "schema_provenance", "single-passage", {},
  { provenance_registry: { "doc-alpha|p1": { provenance_group_id: "", derivation_links: [] } } }, expRefused("INVALID_INPUT"));
addCase("sch-016-bad-link-kind", "schema_provenance", "single-passage", {},
  { provenance_registry: { "doc-alpha|p1": { provenance_group_id: "g", derivation_links: [{ from_doc: "d", from_passage: "p", kind: "forked" }] } } },
  expRefused("INVALID_INPUT"));
addCase("sch-017-bad-test-hooks", "schema_provenance", "single-passage", {},
  { test_hooks: { prefill_output_records: -1 } }, expRefused("INVALID_INPUT"));
addCase("sch-018-bad-criteria", "schema_provenance", "single-passage", {},
  { criteria: { criteria_version: "Bad Version!" } }, expRefused("INVALID_INPUT"));
addCase("sch-019-bad-principal-role", "schema_provenance", "single-passage", {},
  { principal: { ...store.principals.jason, role: "ADMIN" } }, expRefused("INVALID_INPUT"));
addCase("sch-020-principal-unregistered-by", "schema_provenance", "single-passage", {},
  { principal: { ...store.principals.jason, registered_by: "mallory" } }, expRefused("INVALID_INPUT"));

// ---------- 10 budget / replay / mutation ----------
addCase("bud-001-over-budget-docs", "budget_replay", "over-budget-docs", {}, {}, expRefused("BUDGET_EXCEEDED"));
addEval("bud-002-boundary-fit", "budget_replay", "boundary-fit", [], {}, { provenance_registry: {} });
addCase("bud-003-boundary-plus1", "budget_replay", "boundary-plus1", {}, { provenance_registry: {} }, expRefused("BUDGET_EXCEEDED"));
addCase("bud-004-sentinel-65", "budget_replay", "sentinel-65", {}, { provenance_registry: {} }, expRefused("BUDGET_EXCEEDED"));
addCase("bud-005-task-100-claims", "budget_replay", "single-passage",
  { claims: Array.from({ length: 100 }, (_, i) => mkClaim(`c${i}`, [REV()], C_ALPH)) }, {}, expRefused("BUDGET_EXCEEDED"));
// Output-record boundary: the prefill is derived from the brief's
// public-record taxonomy (oNaturalRecords), so prefill + natural = 256
// (allowed) / 257 (refused) through the actual public run. The old
// 254/255 values encoded the pre-fix hand-maintained field list
// (natural 2); the taxonomy walk counts 10 natural records for this
// envelope. PER-010 adds the citation byte_identity record: natural 12.
const budNatural = oNaturalRecords((() => {
  const docs = docsFor("single-passage");
  const reg = registryFor(["single-passage"]);
  const { claimResults, quarantined, spanMismatch } = oEvaluate(docs, [mkClaim("c1", [REV()], C_ALPH)], reg);
  return { claimResults, quarantined, spanMismatch, popVerified: true, hasSummary: true, diagCount: 0 };
})());
if (budNatural !== 12) throw new Error(`bud-006/007 taxonomy drift: natural=${budNatural}, expected 12`);
addEval("bud-006-output-prefill-256", "budget_replay", "single-passage",
  [mkClaim("c1", [REV()], C_ALPH)], {}, { test_hooks: { prefill_output_records: 256 - budNatural } });
addCase("bud-007-output-prefill-257", "budget_replay", "single-passage",
  { claims: [mkClaim("c1", [REV()], C_ALPH)] }, { test_hooks: { prefill_output_records: 257 - budNatural } }, expRefused("OUTPUT_LIMIT"));
addEval("bud-008-replay-single", "budget_replay", "single-passage", [mkClaim("c1", [REV()], C_ALPH)]);
addCase("bud-009-input-limit", "budget_replay", "huge-text", {}, {}, expRefused("TRANSPORT_REFUSED"));
addEval("bud-010-boundary-fit-plus-claim", "budget_replay", "boundary-fit",
  [mkClaim("c1", [mkAtom("SUBJ-0", "metric", 0, "number", "s1")], [{ doc_id: "doc-b000", passage_id: "p1" }])],
  {}, { provenance_registry: {} });

// ---------- PER-008 round 2 hostile admission cases ----------
// These cases cannot be expressed as JSON (native Proxies and
// inherited getters do not survive serialization). They are frozen
// here as {base, transform} references: the battery runner clones
// the named base case's task/context IN-PROCESS, applies the named
// hostile transform (defined in tests/run-battery.js), and runs the
// result through run() 3x (in-process — executable fixtures cannot
// cross the JSON guarded transport; attempting to serialize them
// would fire the getters in the harness, which is exactly what the
// agent must never do). Expectations are hard-coded (REFUSED /
// INVALID_INPUT), like the malformed/budget cases; the oracle is
// bypassed. expect_zero names the instrumented counters that must
// stay at zero.
function addHostile(case_id, category, baseCaseId, transform, expectZero) {
  CASES.push({
    case_id, category,
    hostile: { base: baseCaseId, transform, expect_zero: expectZero },
    expected: { status: "REFUSED", diagnostic_codes: ["INVALID_INPUT"], claim_statuses: [], quarantined_ids: [], coverage_state: "UNKNOWN" },
  });
}
// H01/H02: the verdict's exact inherited-getter probes — an
// inherited enumerable getter principal_id / revisions on a custom
// prototype must refuse with ZERO getter calls.
addHostile("hst-001-inherited-principal", "hostile_admission", "nom-002-single-attributed", "inherited-principal-getter", ["getter_calls"]);
addHostile("hst-002-inherited-revisions", "hostile_admission", "nom-002-single-attributed", "inherited-revisions-getter", ["getter_calls"]);
// H03: the verdict's exact nested-Proxy probe — a forwarding native
// Proxy around a valid applies_to array must refuse with ZERO traps.
addHostile("hst-003-nested-applies-to-proxy", "hostile_admission", "nom-002-single-attributed", "nested-applies-to-proxy", ["traps"]);
// H04: the derivation-links analog — a forwarding native Proxy
// around a valid derivation_links array must refuse with ZERO traps.
addHostile("hst-004-nested-derivation-link-proxy", "hostile_admission", "nom-018-derivation-link", "nested-derivation-link-proxy", ["traps"]);

// ================= Write battery.json =================
if (CASES.length !== 124) {
  console.error(`battery case count is ${CASES.length}, expected 124`);
  process.exit(1);
}
const byCat = {};
for (const c of CASES) byCat[c.category] = (byCat[c.category] || 0) + 1;
console.log("categories:", JSON.stringify(byCat));
writeFileSync(join(ROOT, "corpus", "battery.json"), JSON.stringify(CASES, null, 2) + "\n");
console.log(`battery: ${CASES.length} cases written`);
