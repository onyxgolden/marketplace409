/**
 * oracle.js — INDEPENDENT ORACLE for battery authoring (not part of the scored path).
 *
 * Written separately from src/ directly against the brief's observable
 * behavior: same input/output contract, same refusal codes, same rounding
 * (half-away-from-zero), same dedup and narrative rules. Implemented with
 * its own structure and helpers so agreement with src/index.js is genuine
 * cross-verification rather than shared code. Every divergence found during
 * battery generation was adjudicated against the brief before freezing.
 */

import { createHash } from "node:crypto";

const WM = "DRAFT — SYNTHETIC FIXTURE DATA — NOT A FINANCIAL STATEMENT";
const HEX40 = /^[0-9a-f]{40}$/;

// --- canonical bytes / git blob sha1 (own copy) ---
function canon(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "bigint") return JSON.stringify(v.toString());
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (typeof v === "object") {
    return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}
function gitSha1OfContent(content) {
  const bytes = Buffer.from(canon(content), "utf8");
  const h = createHash("sha1");
  h.update(Buffer.from("blob " + bytes.length + "\0", "utf8"));
  h.update(bytes);
  return h.digest("hex");
}

// --- exact rational math (own copy) ---
const INT_RE = /^-?(0|[1-9][0-9]*)$/;
function toRat(a) {
  if (typeof a === "string" && INT_RE.test(a)) return [BigInt(a), 1n];
  if (a && typeof a === "object" && !Array.isArray(a) &&
      typeof a.numerator === "string" && INT_RE.test(a.numerator) &&
      typeof a.denominator === "string" && /^[1-9][0-9]*$/.test(a.denominator)) {
    return [BigInt(a.numerator), BigInt(a.denominator)];
  }
  return null;
}
const rAdd = (x, y) => [x[0] * y[1] + y[0] * x[1], x[1] * y[1]];
const rSub = (x, y) => [x[0] * y[1] - y[0] * x[1], x[1] * y[1]];
const rEq = (x, y) => x[0] * y[1] === y[0] * x[1];
const rSign = (x) => (x[0] > 0n ? 1 : x[0] < 0n ? -1 : 0);
function rRound(n, d) {
  if (n >= 0n) return (2n * n + d) / (2n * d);
  return (2n * n - d) / (2n * d);
}
function pctStr(v, b) {
  if (rSign(b) === 0) return "NOT_COMPARABLE";
  let num = v[0] * 10000n * b[1];
  let den = v[1] * b[0];
  if (den < 0n) { num = -num; den = -den; }
  const s = rRound(num, den);
  const neg = s < 0n;
  const t = (neg ? -s : s).toString().padStart(3, "0");
  return (neg ? "-" : "") + t.slice(0, -2) + "." + t.slice(-2) + "%";
}

// --- injection families (own copy) ---
function injected(text) {
  if (typeof text !== "string") return null;
  const fams = [
    ["instruction-override", [/\[\s*system\s*\]/i, /\bignore\s+(all\s+)?(previous|prior|earlier)\s+(instructions|directives)\b/i, /\bdisregard\s+(the\s+)?(above|previous|prior)\b/i, /\boverride\b/i, /\bnew\s+instructions\b/i, /\breport\s+ASSEMBLED\s+regardless\b/i]],
    ["exfiltration-directive", [/\bexfiltrat\w*\b/i, /\bsend\s+(this|the\s+data|it)\s+to\b/i]],
    ["role-spoof", [/\byou\s+are\s+now\b/i, /\bact\s+as\s+(a\s+)?(root|admin|jason)\b/i]],
  ];
  for (const [fam, pats] of fams) {
    for (const p of pats) if (p.test(text)) return fam;
  }
  return null;
}

// --- strict validation (own copy) ---
function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
function keysOk(o, allowed, required, path, errs) {
  for (const k of Object.keys(o)) if (!allowed.has(k)) errs.push(path + ": unknown property " + JSON.stringify(k));
  for (const k of required) if (!(k in o)) errs.push(path + ": missing required property " + JSON.stringify(k));
}
const nonEmpty = (v) => typeof v === "string" && v.length > 0;
const strArr = (v) => Array.isArray(v) && v.every((x) => typeof x === "string");
function realDate(s) {
  const m = typeof s === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) : null;
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function checkRef(r, path, errs) {
  if (!isObj(r)) { errs.push(path + ": SourceRef must be an object"); return; }
  keysOk(r, new Set(["repo", "path", "commit", "blob", "algorithm", "revision"]),
    ["repo", "path", "commit", "blob", "algorithm", "revision"], path, errs);
  if (!nonEmpty(r.repo)) errs.push(path + ".repo: must be a non-empty string");
  if (typeof r.path !== "string" || r.path.length === 0) errs.push(path + ".path: must be a non-empty string");
  else if (r.path.startsWith("/") || r.path.includes("\\") || r.path.split("/").includes(".."))
    errs.push(path + ".path: traversal/absolute paths rejected");
  if (typeof r.commit !== "string" || !HEX40.test(r.commit)) errs.push(path + ".commit: must be a full lowercase 40-hex Git object ID");
  if (typeof r.blob !== "string" || !HEX40.test(r.blob)) errs.push(path + ".blob: must be a full lowercase 40-hex Git object ID");
  if (r.algorithm !== "git-sha1") errs.push(path + '.algorithm: must be "git-sha1"');
  if (!nonEmpty(r.revision)) errs.push(path + ".revision: must be a non-empty string");
}

function checkLine(l, path, errs) {
  if (!isObj(l)) { errs.push(path + ": line must be an object"); return; }
  keysOk(l, new Set(["line_id", "category", "budget_minor", "actual_minor", "source_labels", "support_strength", "flags"]),
    ["line_id", "category", "budget_minor", "actual_minor", "source_labels", "support_strength", "flags"], path, errs);
  if (!nonEmpty(l.line_id)) errs.push(path + ".line_id: must be a non-empty string");
  if (l.category !== "revenue" && l.category !== "expense") errs.push(path + '.category: must be "revenue" or "expense"');
  if (!toRat(l.budget_minor)) errs.push(path + ".budget_minor: amount must be a signed integer decimal string or {numerator, denominator} decimal strings (denominator positive)");
  if (!toRat(l.actual_minor)) errs.push(path + ".actual_minor: amount must be a signed integer decimal string or {numerator, denominator} decimal strings (denominator positive)");
  if (!strArr(l.source_labels)) errs.push(path + ".source_labels: must be an array of strings");
  if (l.support_strength !== null && l.support_strength !== "verified" && l.support_strength !== "attributed")
    errs.push(path + '.support_strength: must be "verified", "attributed" or null');
  if (!strArr(l.flags)) errs.push(path + ".flags: must be an array of strings");
}

function checkSection(s, path, errs) {
  if (!isObj(s)) { errs.push(path + ": section must be an object"); return; }
  keysOk(s, new Set(["section_id", "currency", "minor_unit_scale", "population_id", "period_start", "period_end", "disjoint_proof", "lines", "claimed_totals", "narrative_claims"]),
    ["section_id", "currency", "minor_unit_scale", "population_id", "period_start", "period_end", "lines", "claimed_totals", "narrative_claims"], path, errs);
  if (!nonEmpty(s.section_id)) errs.push(path + ".section_id: must be a non-empty string");
  if (typeof s.currency !== "string" || !/^[A-Z]{3}$/.test(s.currency)) errs.push(path + ".currency: must be a 3-letter uppercase code");
  if (!Number.isInteger(s.minor_unit_scale) || s.minor_unit_scale < 0 || s.minor_unit_scale > 6)
    errs.push(path + ".minor_unit_scale: must be an integer 0..6");
  if (!nonEmpty(s.population_id)) errs.push(path + ".population_id: must be a non-empty string");
  if (!realDate(s.period_start)) errs.push(path + ".period_start: must be a real YYYY-MM-DD date");
  if (!realDate(s.period_end)) errs.push(path + ".period_end: must be a real YYYY-MM-DD date");
  if (realDate(s.period_start) && realDate(s.period_end) && s.period_start > s.period_end)
    errs.push(path + ": period_start must not be after period_end");
  if ("disjoint_proof" in s && typeof s.disjoint_proof !== "boolean") errs.push(path + ".disjoint_proof: must be a boolean when present");
  if (!Array.isArray(s.lines)) errs.push(path + ".lines: must be an array");
  else {
    // NOTE: duplicate line_ids are intentionally allowed: the brief's dedup
    // stage owns them (identical copies merge, conflicting copies contradict).
    s.lines.forEach((l, i) => {
      checkLine(l, path + ".lines[" + i + "]", errs);
    });
  }
  if (!Array.isArray(s.claimed_totals)) errs.push(path + ".claimed_totals: must be an array");
  else s.claimed_totals.forEach((ct, i) => {
    const p = path + ".claimed_totals[" + i + "]";
    if (!isObj(ct)) { errs.push(p + ": claimed_total must be an object"); return; }
    keysOk(ct, new Set(["claim_id", "line_ids", "claimed_budget_minor", "claimed_actual_minor"]),
      ["claim_id", "line_ids", "claimed_budget_minor", "claimed_actual_minor"], p, errs);
    if (!nonEmpty(ct.claim_id)) errs.push(p + ".claim_id: must be a non-empty string");
    if (!Array.isArray(ct.line_ids) || ct.line_ids.length === 0 || !ct.line_ids.every(nonEmpty))
      errs.push(p + ".line_ids: must be a non-empty array of non-empty strings");
    if (!toRat(ct.claimed_budget_minor)) errs.push(p + ".claimed_budget_minor: amount must be a signed integer decimal string or {numerator, denominator} decimal strings (denominator positive)");
    if (!toRat(ct.claimed_actual_minor)) errs.push(p + ".claimed_actual_minor: amount must be a signed integer decimal string or {numerator, denominator} decimal strings (denominator positive)");
  });
  if (!Array.isArray(s.narrative_claims)) errs.push(path + ".narrative_claims: must be an array");
  else {
    const seen = new Set();
    s.narrative_claims.forEach((nc, i) => {
      const p = path + ".narrative_claims[" + i + "]";
      if (!isObj(nc)) { errs.push(p + ": narrative_claim must be an object"); return; }
      keysOk(nc, new Set(["claim_id", "kind", "metric", "line_ids", "direction", "quoted_text", "basis_refs"]),
        ["claim_id", "kind", "metric", "line_ids", "direction", "quoted_text", "basis_refs"], p, errs);
      if (!nonEmpty(nc.claim_id)) errs.push(p + ".claim_id: must be a non-empty string");
      if (nc.kind !== "movement" && nc.kind !== "cause") errs.push(p + '.kind: must be "movement" or "cause"');
      if (nc.metric !== "variance" && nc.metric !== "actual") errs.push(p + '.metric: must be "variance" or "actual"');
      if (!Array.isArray(nc.line_ids) || nc.line_ids.length === 0 || !nc.line_ids.every(nonEmpty))
        errs.push(p + ".line_ids: must be a non-empty array of non-empty strings");
      if (nc.direction !== "up" && nc.direction !== "down" && nc.direction !== "flat")
        errs.push(p + '.direction: must be "up", "down" or "flat"');
      if (typeof nc.quoted_text !== "string" || nc.quoted_text.length === 0)
        errs.push(p + ".quoted_text: must be a non-empty string");
      if (!Array.isArray(nc.basis_refs)) errs.push(p + ".basis_refs: must be an array");
      else nc.basis_refs.forEach((b, j) => {
        const q = p + ".basis_refs[" + j + "]";
        if (!isObj(b)) { errs.push(q + ": basis_ref must be an object"); return; }
        keysOk(b, new Set(["basis_id", "verified", "bounded_fact"]), ["basis_id", "verified", "bounded_fact"], q, errs);
        if (!nonEmpty(b.basis_id)) errs.push(q + ".basis_id: must be a non-empty string");
        if (typeof b.verified !== "boolean") errs.push(q + ".verified: must be a boolean");
        if (typeof b.bounded_fact !== "string") errs.push(q + ".bounded_fact: must be a string");
      });
      if (isObj(nc) && typeof nc.claim_id === "string") {
        if (seen.has(nc.claim_id)) errs.push(p + ": duplicate claim_id");
        seen.add(nc.claim_id);
      }
    });
  }
}

function checkTask(t) {
  const errs = [];
  if (!isObj(t)) return ["task: must be an object"];
  keysOk(t, new Set(["task_id", "bundle_refs", "period_ids", "requested_action"]),
    ["task_id", "bundle_refs", "period_ids", "requested_action"], "task", errs);
  if (!nonEmpty(t.task_id)) errs.push("task.task_id: must be a non-empty string");
  if (!Array.isArray(t.bundle_refs) || t.bundle_refs.length === 0) errs.push("task.bundle_refs: must be a non-empty array of SourceRef");
  else t.bundle_refs.forEach((r, i) => checkRef(r, "task.bundle_refs[" + i + "]", errs));
  if (!strArr(t.period_ids)) errs.push("task.period_ids: must be an array of strings");
  if (typeof t.requested_action !== "string" || t.requested_action.length === 0)
    errs.push("task.requested_action: must be a non-empty string");
  return errs;
}

// --- assembly (own structure) ---

function D(code, severity, reason, sourceRef, recordId) {
  return { code, severity, source_ref: sourceRef || null, record_id: recordId || null, reason };
}
function sortD(ds) {
  return ds.slice().sort((a, b) => a.code < b.code ? -1 : a.code > b.code ? 1 : a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0);
}
function base(taskId, refs) {
  return {
    schema_version: "1", agent: "financial-manager", task_id: taskId,
    advisory: true, fixture_only: true, source_refs: refs || [],
    diagnostics: [], quarantined_sources: [], routing_flags: [], complete: false,
  };
}
function deny(taskId, code, sev, reason, refs, quar) {
  const e = base(taskId, refs);
  e.status = "REFUSED"; e.watermark = WM;
  e.diagnostics = [D(code, sev, reason, null, null)];
  e.quarantined_sources = quar || []; e.routing_flags = quar && quar.length ? ["quarantine-review"] : [];
  e.sections = []; e.package_complete = false; e.exceptions = [];
  e.rollup = { possible: false, reason: code, totals: null, sections_included: [] };
  return e;
}
function uniqUnion(arrays) {
  const out = [], seen = new Set();
  for (const a of arrays) for (const v of a) if (!seen.has(v)) { seen.add(v); out.push(v); }
  return out;
}
const supRank = (s) => (s === "verified" ? 2 : s === "attributed" ? 1 : 0);
const supName = (r) => (r >= 2 ? "verified" : r === 1 ? "attributed-only" : "unverifiable");
function favOf(cat, s) {
  if (s === 0) return "neutral";
  return cat === "revenue" ? (s > 0 ? "favorable" : "unfavorable") : (s > 0 ? "unfavorable" : "favorable");
}

function assembleSection(sec, ref, externalContra = []) {
  const sid = sec.section_id;
  const diags = [];
  const flagSet = new Set();
  // dedup
  const groups = new Map();
  for (const l of sec.lines) {
    const k = [sec.population_id, l.line_id, sec.period_start, sec.period_end, sec.currency, String(sec.minor_unit_scale), l.category].join(" ");
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(l);
  }
  const merged = [];
  const contra = [];
  for (const copies of groups.values()) {
    const b0 = toRat(copies[0].budget_minor), a0 = toRat(copies[0].actual_minor);
    const bad = copies.filter((c) => !rEq(toRat(c.budget_minor), b0) || !rEq(toRat(c.actual_minor), a0));
    if (bad.length) {
      contra.push({ line_id: copies[0].line_id, alternatives: copies.map((c) => ({ budget_minor: c.budget_minor, actual_minor: c.actual_minor, source_labels: c.source_labels })) });
      continue;
    }
    let r = 2;
    for (const c of copies) r = Math.min(r, supRank(c.support_strength));
    merged.push({
      line_id: copies[0].line_id, category: copies[0].category,
      budget_minor: copies[0].budget_minor, actual_minor: copies[0].actual_minor,
      source_labels: uniqUnion(copies.map((c) => c.source_labels)),
      support_strength: r === 2 ? "verified" : r === 1 ? "attributed" : null,
      flags: uniqUnion(copies.map((c) => c.flags)),
    });
  }
  merged.sort((a, b) => (a.line_id < b.line_id ? -1 : 1));
  // FM-001: cross-section contradictions from bundle dedup block here too.
  for (const c of externalContra) {
    contra.push({ line_id: c.line_id, alternatives: c.alternatives });
  }
  const allLabels = uniqUnion(merged.map((l) => l.source_labels));
  const allFlags = [...new Set(uniqUnion(merged.map((l) => l.flags)))].sort();
  const blockedOut = (code, sev, reason, excs, extraFlags) => ({
    section_id: sid, complete: false, amounts: null, variances: null,
    claimed_vs_recomputed: [], source_labels: allLabels, support_strength: "unverifiable",
    flags: [...new Set([...allFlags, ...(extraFlags || [])])].sort(), narrative_results: [],
    diagnostics: sortD(diags.concat([D(code, sev, reason, ref, sid)])),
    _exc: excs || [], _lr: [],
  });
  if (contra.length) {
    for (const c of contra) flagSet.add("contradicted");
    return blockedOut("CONTRADICTION", "error",
      "dedup identity conflict on " + contra.map((c) => c.line_id).join(",") + ": contradicted aggregate has no single figure",
      contra.map((c) => ({ code: "CONTRADICTION", severity: "error", section_id: sid, reason: "conflicting copies for line " + c.line_id + ": no single aggregate", alternatives: c.alternatives })),
      ["contradicted"]);
  }
  const detail = merged.filter((l) => !l.flags.includes("summary-row"));
  const sums = merged.filter((l) => l.flags.includes("summary-row"));
  if (sums.length && detail.length && sec.disjoint_proof !== true) {
    return blockedOut("UNVERIFIABLE_POPULATION", "error", "summary rows overlap detail populations without disjoint-population proof");
  }
  const unlabeled = merged.filter((l) => l.source_labels.length === 0).map((l) => l.line_id);
  if (unlabeled.length) {
    return blockedOut("MISSING_LABELS", "error", "lines missing source labels: " + unlabeled.join(","));
  }
  // FM-002: proven-disjoint summaries count exactly once; they are never
  // silently dropped. Summary-only populations have nothing to overlap.
  const counted = merged;
  // line math
  const lr = counted.map((l) => {
    const b = toRat(l.budget_minor), a = toRat(l.actual_minor), v = rSub(a, b);
    const s = rSign(v);
    return {
      line_id: l.line_id, category: l.category,
      budget_minor: rRound(b[0], b[1]).toString(), budget_exact: b[0] + "/" + b[1],
      actual_minor: rRound(a[0], a[1]).toString(), actual_exact: a[0] + "/" + a[1],
      variance_minor: rRound(v[0], v[1]).toString(), variance_exact: v[0] + "/" + v[1],
      favorability: favOf(l.category, s), pct_variance: pctStr(v, b),
      source_labels: l.source_labels.slice(), support_strength: supName(supRank(l.support_strength)),
      flags: l.flags.slice(), _b: b, _a: a, _v: v,
    };
  });
  const byCat = (c) => lr.filter((x) => x.category === c);
  const tot = (list) => {
    let b = [0n, 1n], a = [0n, 1n];
    for (const x of list) { b = rAdd(b, x._b); a = rAdd(a, x._a); }
    const v = rSub(a, b);
    return { b, a, v, bm: rRound(b[0], b[1]).toString(), am: rRound(a[0], a[1]).toString(), vm: rRound(v[0], v[1]).toString() };
  };
  const rev = tot(byCat("revenue")), exp = tot(byCat("expense"));
  const hasR = byCat("revenue").length > 0, hasE = byCat("expense").length > 0;
  let net = null;
  if (hasR || hasE) {
    const nb = rSub(hasR ? rev.b : [0n, 1n], hasE ? exp.b : [0n, 1n]);
    const na = rSub(hasR ? rev.a : [0n, 1n], hasE ? exp.a : [0n, 1n]);
    const nv = rSub(na, nb);
    net = {
      budget_minor: rRound(nb[0], nb[1]).toString(), actual_minor: rRound(na[0], na[1]).toString(),
      variance_minor: rRound(nv[0], nv[1]).toString(),
      budget_exact: nb[0] + "/" + nb[1], actual_exact: na[0] + "/" + na[1], variance_exact: nv[0] + "/" + nv[1],
    };
  }
  const lineMap = new Map(lr.map((x) => [x.line_id, x]));
  // claimed totals
  const claimedVs = [];
  for (const ct of sec.claimed_totals) {
    const miss = ct.line_ids.filter((id) => !lineMap.has(id));
    if (miss.length) {
      claimedVs.push({ claim_id: ct.claim_id, state: "unverifiable", recomputed_budget_minor: null, recomputed_actual_minor: null, evidence: [{ reason: "unknown line_ids", line_ids: miss }] });
      continue;
    }
    let b = [0n, 1n], a = [0n, 1n];
    for (const id of ct.line_ids) { const x = lineMap.get(id); b = rAdd(b, x._b); a = rAdd(a, x._a); }
    const rb = rRound(b[0], b[1]).toString(), ra = rRound(a[0], a[1]).toString();
    const cb = rRound(...toRat(ct.claimed_budget_minor)).toString();
    const ca = rRound(...toRat(ct.claimed_actual_minor)).toString();
    const ok = rb === cb && ra === ca;
    if (!ok) {
      flagSet.add("mismatch");
      diags.push(D("CLAIM_MISMATCH", "warning", "claimed total " + ct.claim_id + " does not match recomputation", ref, ct.claim_id));
    }
    claimedVs.push({ claim_id: ct.claim_id, state: ok ? "match" : "mismatch", recomputed_budget_minor: rb, recomputed_actual_minor: ra });
  }
  // narrative
  const narr = [];
  let worst = 2;
  for (const l of merged) worst = Math.min(worst, supRank(l.support_strength));
  for (const c of sec.narrative_claims) {
    const miss = c.line_ids.filter((id) => !lineMap.has(id));
    if (miss.length) {
      narr.push({ claim_id: c.claim_id, state: "unverifiable", arithmetic_verified: false, causal_support: c.kind === "cause" ? "unsupported" : "not_applicable", evidence: [{ reason: "unknown line_ids", line_ids: miss }] });
      continue;
    }
    const xs = c.line_ids.map((id) => lineMap.get(id));
    let vs = [0n, 1n];
    for (const x of xs) vs = rAdd(vs, x._v);
    const dir = rSign(vs) > 0 ? "up" : rSign(vs) < 0 ? "down" : "flat";
    const arithOk = dir === c.direction;
    if (c.kind === "movement") {
      let r2 = 2;
      for (const x of xs) r2 = Math.min(r2, supRank(x.support_strength === "verified" ? "verified" : x.support_strength === "attributed-only" ? "attributed" : null));
      narr.push({
        claim_id: c.claim_id, state: arithOk ? "verified" : "mismatch",
        arithmetic_verified: arithOk, causal_support: "not_applicable",
        evidence: xs.map((x) => ({ line_id: x.line_id, metric: c.metric, variance_minor: x.variance_minor, direction: dir })),
      });
      if (!arithOk) { flagSet.add("mismatch"); diags.push(D("NARRATIVE_MISMATCH", "warning", "narrative claim " + c.claim_id + " contradicts recomputed arithmetic", ref, c.claim_id)); }
      worst = Math.min(worst, r2);
    } else {
      const bases = (c.basis_refs || []).filter((bb) =>
        bb.verified === true && typeof bb.bounded_fact === "string" && bb.bounded_fact.length > 0 &&
        c.line_ids.some((id) => bb.bounded_fact.includes(id)));
      const supported = bases.length > 0;
      const state = !arithOk ? "mismatch" : supported ? "verified" : "unverifiable";
      narr.push({
        claim_id: c.claim_id, state, arithmetic_verified: arithOk,
        causal_support: supported ? "supported" : "unsupported",
        evidence: supported
          ? bases.map((bb) => ({ basis_id: bb.basis_id, bounded_fact: bb.bounded_fact }))
          : [{ attribution: "unsupported", quoted_text: c.quoted_text }],
      });
      if (state === "mismatch") { flagSet.add("mismatch"); diags.push(D("NARRATIVE_MISMATCH", "warning", "narrative claim " + c.claim_id + " contradicts recomputed arithmetic", ref, c.claim_id)); }
      if (state === "unverifiable") diags.push(D("UNSUPPORTED_CAUSE", "warning", "narrative claim " + c.claim_id + " attributes cause without verified fixture basis", ref, c.claim_id));
    }
  }
  for (const l of merged) for (const f of l.flags) flagSet.add(f);
  const pub = (x) => { const { _b, _a, _v, ...rest } = x; return rest; };
  return {
    section_id: sid, complete: true,
    amounts: {
      currency: sec.currency, minor_unit_scale: sec.minor_unit_scale,
      revenue: hasR ? { budget_minor: rev.bm, actual_minor: rev.am } : null,
      expense: hasE ? { budget_minor: exp.bm, actual_minor: exp.am } : null,
      net_income: net,
      lines: lr.map(pub),
      totals_exact: {
        revenue_budget: hasR ? rev.b[0] + "/" + rev.b[1] : null,
        revenue_actual: hasR ? rev.a[0] + "/" + rev.a[1] : null,
        expense_budget: hasE ? exp.b[0] + "/" + exp.b[1] : null,
        expense_actual: hasE ? exp.a[0] + "/" + exp.a[1] : null,
      },
    },
    variances: {
      lines: lr.map((x) => ({ line_id: x.line_id, variance_minor: x.variance_minor, variance_exact: x.variance_exact, favorability: x.favorability, pct_variance: x.pct_variance })),
      totals: {
        revenue_variance_minor: hasR ? rev.vm : null,
        expense_variance_minor: hasE ? exp.vm : null,
        net_income_variance_minor: net ? net.variance_minor : null,
      },
    },
    claimed_vs_recomputed: claimedVs,
    source_labels: allLabels,
    support_strength: supName(worst),
    flags: [...flagSet].sort(),
    narrative_results: narr,
    diagnostics: sortD(diags),
    _exc: [], _lr: lr,
  };
}

function overlap(aS, aE, bS, bE) { return aS <= bE && bS <= aE; }

export function oracleRun(task, context) {
  const errs = checkTask(task);
  if (errs.length) return deny(task && isObj(task) ? task.task_id : null, "INVALID_INPUT", "error", errs.join("; "));
  const tid = task.task_id;
  const taskBytes = Buffer.byteLength(JSON.stringify(task), "utf8");
  if (taskBytes > 262144)
    return deny(tid, "INPUT_LIMIT", "error", "input " + taskBytes + " bytes exceeds 262144");
  if (task.requested_action !== "assemble_draft")
    return deny(tid, "ACTION_DENIED", "error", "requested_action " + JSON.stringify(task.requested_action) + ' is not permitted; only "assemble_draft"', task.bundle_refs);
  const ctx = isObj(context) ? context : {};
  const clockOk = typeof ctx.clock === "string" && (/^\d{4}-\d{2}-\d{2}$/.test(ctx.clock) || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(ctx.clock)) && Number.isFinite(Date.parse(ctx.clock + (ctx.clock.endsWith("Z") ? "" : "T00:00:00Z")));
  if (!clockOk) return deny(tid, "INVALID_INPUT", "error", "context.clock must be a real YYYY-MM-DD date or finite UTC ISO timestamp with Z");
  const approved = Array.isArray(ctx.approvedRepos) ? ctx.approvedRepos : ["forge-ai-drop-fixtures"];
  const store = isObj(ctx.fixtureStore) && isObj(ctx.fixtureStore.fixtures) ? ctx.fixtureStore.fixtures : null;
  const resolved = [];
  for (const ref of task.bundle_refs) {
    if (!approved.includes(ref.repo))
      return deny(tid, "ACTION_DENIED", "error", "repo " + JSON.stringify(ref.repo) + " is not an approved synthetic fixture root; live or external ledgers are never readable", task.bundle_refs);
    if (!store) return deny(tid, "READ_DENIED", "error", "fixture store unavailable", task.bundle_refs);
    let hit = null;
    for (const id of Object.keys(store)) {
      const sr = store[id] && store[id].source_ref;
      if (sr && sr.repo === ref.repo && sr.path === ref.path && sr.commit === ref.commit) { hit = { id, f: store[id] }; break; }
    }
    if (!hit) return deny(tid, "SOURCE_UNVERIFIED", "error", "no registered fixture for " + ref.repo + " " + ref.path + " @ " + ref.commit.slice(0, 12), task.bundle_refs);
    if (gitSha1OfContent(hit.f.content) !== ref.blob)
      return deny(tid, "HASH_MISMATCH", "error", "blob pin mismatch for fixture " + hit.id, task.bundle_refs);
    resolved.push({ ref, content: hit.f.content, id: hit.id });
  }
  const secs = [];
  for (const r of resolved) {
    if (!isObj(r.content) || !Array.isArray(r.content.sections))
      return deny(tid, "INVALID_INPUT", "error", "fixture " + r.id + " content.sections must be an array", task.bundle_refs);
    const serrs = [];
    r.content.sections.forEach((s, i) => checkSection(s, "sections[" + i + "]", serrs));
    if (serrs.length) return deny(tid, "INVALID_INPUT", "error", serrs.join("; "), task.bundle_refs);
    for (const s of r.content.sections) secs.push({ sec: s, ref: r.ref });
  }
  const seen = new Set();
  for (const { sec } of secs) {
    if (seen.has(sec.section_id)) return deny(tid, "INVALID_INPUT", "error", "duplicate section_id " + JSON.stringify(sec.section_id), task.bundle_refs);
    seen.add(sec.section_id);
  }
  if (!secs.length) return deny(tid, "INVALID_INPUT", "error", "no sections resolved from bundle_refs", task.bundle_refs);
  // FM-005: charge the exact registered fixture bytes actually consulted
  // (canonical pinned bytes) together with the task envelope, before walking.
  let fixBytes = 0;
  for (const r of resolved) fixBytes += Buffer.from(canon(r.content), "utf8").length;
  if (taskBytes + fixBytes > 262144)
    return deny(tid, "INPUT_LIMIT", "error", "input " + (taskBytes + fixBytes) + " bytes (task " + taskBytes + " + resolved fixtures " + fixBytes + ") exceeds 262144", task.bundle_refs);
  // FM-001: bundle-wide dedup on working copies before totals/budgets/scans.
  const working = secs.map(({ sec, ref }) => ({
    sec: {
      ...sec,
      lines: sec.lines.map((l) => ({ ...l, source_labels: [...l.source_labels], flags: [...l.flags] })),
    },
    ref,
  }));
  const bContra = new Map();
  {
    const byKey = new Map();
    working.forEach(({ sec }, si) => {
      for (const line of sec.lines) {
        const k = [sec.population_id, line.line_id, sec.period_start, sec.period_end, sec.currency, String(sec.minor_unit_scale), line.category].join(" ");
        if (!byKey.has(k)) byKey.set(k, []);
        byKey.get(k).push({ si, line });
      }
    });
    for (const [key, copies] of byKey) {
      const idxs = [...new Set(copies.map((c) => c.si))];
      if (idxs.length < 2) continue;
      const b0 = toRat(copies[0].line.budget_minor), a0 = toRat(copies[0].line.actual_minor);
      const bad = copies.some((c) => !rEq(toRat(c.line.budget_minor), b0) || !rEq(toRat(c.line.actual_minor), a0));
      if (bad) {
        const entry = {
          line_id: copies[0].line.line_id,
          alternatives: copies.map((c) => ({
            section_id: working[c.si].sec.section_id,
            budget_minor: c.line.budget_minor, actual_minor: c.line.actual_minor,
            source_labels: c.line.source_labels.slice(),
          })),
        };
        for (const si of idxs) {
          if (!bContra.has(si)) bContra.set(si, []);
          bContra.get(si).push(entry);
        }
        continue;
      }
      const first = copies[0];
      first.line.source_labels = uniqUnion(copies.map((c) => c.line.source_labels));
      first.line.flags = uniqUnion(copies.map((c) => c.line.flags));
      let r = 2;
      for (const c of copies) r = Math.min(r, supRank(c.line.support_strength));
      first.line.support_strength = r === 2 ? "verified" : r === 1 ? "attributed" : null;
      for (let n = 1; n < copies.length; n++) {
        const arr = working[copies[n].si].sec.lines;
        const at = arr.indexOf(copies[n].line);
        if (at >= 0) arr.splice(at, 1);
      }
    }
  }
  let res = task.bundle_refs.length, spans = 0;
  for (const { sec } of working) {
    res += sec.lines.length + sec.narrative_claims.length + sec.claimed_totals.length;
    for (const l of sec.lines) spans += l.source_labels.length;
    spans += sec.narrative_claims.length;
  }
  if (res > 64 || spans > 512) return deny(tid, "BUDGET_EXCEEDED", "error", "budget exceeded: " + res + " resolutions / " + spans + " spans", task.bundle_refs);
  const quar = [];
  for (const { sec } of working) for (const c of sec.narrative_claims) {
    const fam = injected(c.quoted_text);
    if (fam) quar.push({ section_id: sec.section_id, claim_id: c.claim_id, family: fam });
  }
  if (quar.length) return deny(tid, "INSTRUCTION_INJECTION", "error", "seeded instruction-injection family detected in narrative claims; sources quarantined", task.bundle_refs, quar);
  const results = working.map(({ sec, ref }, i) => assembleSection(sec, ref, bContra.get(i) || []));
  // rollup
  let rollup;
  {
    const byPop = new Map();
    for (const { sec } of working) {
      if (!byPop.has(sec.population_id)) byPop.set(sec.population_id, []);
      byPop.get(sec.population_id).push(sec);
    }
    let blockedReason = null;
    outer: for (const list of byPop.values()) {
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const A = list[i], B = list[j];
        const same = A.period_start === B.period_start && A.period_end === B.period_end;
        if (!same && overlap(A.period_start, A.period_end, B.period_start, B.period_end)) { blockedReason = "OVERLAPPING_PERIODS"; break outer; }
      }
    }
    const comp = results.filter((r) => r.complete);
    if (!blockedReason) {
      if (comp.length !== results.length) blockedReason = "INCOMPLETE_SECTIONS";
      else if (new Set(working.filter((_, i) => results[i].complete).map(({ sec }) => sec.currency)).size > 1) blockedReason = "MIXED_CURRENCY";
      else if (new Set(working.filter((_, i) => results[i].complete).map(({ sec }) => String(sec.minor_unit_scale))).size > 1) blockedReason = "MIXED_SCALE";
    }
    if (blockedReason) rollup = { possible: false, reason: blockedReason, totals: null, sections_included: [] };
    else {
      // FM-003: category totals preserved; net income = revenue - expense.
      // No combined revenue-plus-expense figure is ever exposed.
      let rb = [0n, 1n], ra = [0n, 1n], eb = [0n, 1n], ea = [0n, 1n];
      let hasR = false, hasE = false;
      for (const r of comp) {
        for (const x of r._lr) {
          if (x.category === "revenue") { hasR = true; rb = rAdd(rb, x._b); ra = rAdd(ra, x._a); }
          else if (x.category === "expense") { hasE = true; eb = rAdd(eb, x._b); ea = rAdd(ea, x._a); }
        }
      }
      const m3 = (b, a) => {
        const v = rSub(a, b);
        return { budget_minor: rRound(b[0], b[1]).toString(), actual_minor: rRound(a[0], a[1]).toString(), variance_minor: rRound(v[0], v[1]).toString() };
      };
      const revenue = hasR ? m3(rb, ra) : null;
      const expense = hasE ? m3(eb, ea) : null;
      const net = (hasR || hasE) ? m3(rSub(hasR ? rb : [0n, 1n], hasE ? eb : [0n, 1n]), rSub(hasR ? ra : [0n, 1n], hasE ? ea : [0n, 1n])) : null;
      rollup = { possible: true, reason: null, totals: { revenue, expense, net_income: net }, sections_included: comp.map((r) => r.section_id) };
    }
  }
  const nComplete = results.filter((r) => r.complete).length;
  const status = nComplete === results.length ? "ASSEMBLED" : nComplete > 0 ? "PARTIAL" : "BLOCKED";
  let outRecs = 1;
  for (const r of results) outRecs += 1 + r._lr.length + r.narrative_results.length + r.claimed_vs_recomputed.length;
  if (outRecs > 256) return deny(tid, "OUTPUT_LIMIT", "error", "output " + outRecs + " records exceeds 256", task.bundle_refs);
  const pubSecs = results.map((r) => { const { _exc, _lr, ...p } = r; return p; });
  const excs = [];
  for (const r of results) for (const e of r._exc) excs.push(e);
  if (!rollup.possible && rollup.reason && rollup.reason !== "INCOMPLETE_SECTIONS")
    excs.push({ code: rollup.reason, severity: "error", section_id: null, reason: "cross-section aggregate blocked: " + rollup.reason + "; no FX or overlap guesses made" });
  const env = base(tid, task.bundle_refs);
  env.status = status; env.watermark = WM; env.sections = pubSecs;
  env.package_complete = status === "ASSEMBLED"; env.complete = env.package_complete;
  env.exceptions = excs; env.rollup = rollup;
  const ds = [];
  for (const r of results) for (const d of r.diagnostics) ds.push(d);
  env.diagnostics = sortD(ds);
  if (Buffer.byteLength(JSON.stringify(env), "utf8") > 262144)
    return deny(tid, "OUTPUT_LIMIT", "error", "output exceeds 262144 bytes", task.bundle_refs);
  return env;
}

export default { oracleRun };
