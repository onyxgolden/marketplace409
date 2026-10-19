/** research.test.js — Research Agent domain rules: the v2 taxonomy,
 * precedence, typed matching, corroboration classes, and axis independence.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/index.js";
import { sameAssertion, assertsConflict, classifyCorroboration, detectCitationCycles, verifyAssertionSpan } from "../src/research.js";
import { renderAssertionText } from "../src/schemas.js";
import { makeBudget } from "../src/resolver.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));

function registryFor(bundle) {
  const ref = store.bundleRefs[bundle];
  const docs = JSON.parse(store.sources[`${ref.repo}|${ref.path}`].revisions[ref.commit].text);
  const reg = {};
  for (const d of docs) for (const p of d.passages || []) {
    const k = `${d.doc_id}|${p.passage_id}`;
    if (store.provenanceRegistry[k]) reg[k] = store.provenanceRegistry[k];
  }
  return reg;
}
function ctxFor(bundle, overrides = {}) {
  const ref = store.bundleRefs[bundle];
  const key = `${ref.repo}|${ref.path}`;
  return {
    clock: 1780315200000,
    sources: { [key]: store.sources[key] },
    readGrants: [{ repo: ref.repo, path: ref.path }],
    principal: store.principals.jason,
    criteria: store.criteriaPresets.standard,
    provenance_registry: registryFor(bundle),
    ...overrides,
  };
}
function taskFor(bundle, claims, opts = {}) {
  const ref = store.bundleRefs[bundle];
  const n = JSON.parse(store.sources[`${ref.repo}|${ref.path}`].revisions[ref.commit].text).length;
  return {
    schema_version: "1", task_id: "research-test", operation: "analyze",
    fixture_refs: { evidence_bundle: ref },
    options: {
      population: { declared_total: opts.declared ?? n, complete: opts.complete ?? true },
      requested_claims: claims,
    },
  };
}
const REV = { subject: "ACME-CORP", predicate: "q3-revenue", value: 1200000, value_type: "number", scope: "fy-2026-q3", polarity: "positive" };
const claim = (id, atoms, refs) => ({ claim_id: id, atoms, origin_passage_refs: refs });

function runClaim(bundle, claimObj, ctxOverrides) {
  const r = run(taskFor(bundle, [claimObj]), ctxFor(bundle, ctxOverrides));
  return r;
}

// ---- Pure predicate unit tests ----
test("sameAssertion is typed: number 5 !== string '5'", () => {
  const a = { subject: "S", predicate: "p", value: 5, value_type: "number", scope: "s", polarity: "positive" };
  const b = { ...a, value: "5", value_type: "string" };
  assert.equal(sameAssertion(a, b), false);
  assert.equal(sameAssertion(a, { ...a }), true);
});

test("sameAssertion includes polarity", () => {
  const a = { subject: "S", predicate: "p", value: true, value_type: "boolean", scope: "s", polarity: "positive" };
  assert.equal(sameAssertion(a, { ...a, polarity: "negative" }), false);
});

test("assertsConflict: same scope+type, differing value", () => {
  const a = { ...REV };
  const b = { ...REV, value: 800000 };
  assert.equal(assertsConflict(a, b), true);
});

test("assertsConflict: opposite polarity conflicts", () => {
  const a = { ...REV };
  const b = { ...REV, polarity: "negative" };
  assert.equal(assertsConflict(a, b), true);
});

test("assertsConflict: different scope is not a conflict", () => {
  const a = { ...REV };
  const b = { ...REV, scope: "fy-2026-q4" };
  assert.equal(assertsConflict(a, b), false);
});

test("assertsConflict: different value type is not a conflict", () => {
  const a = { ...REV };
  const b = { ...REV, value: "1200000", value_type: "string" };
  assert.equal(assertsConflict(a, b), false);
});

test("assertsConflict: identical assertions do not conflict", () => {
  assert.equal(assertsConflict(REV, { ...REV }), false);
});

test("renderAssertionText grammar", () => {
  assert.equal(renderAssertionText(REV), `ACME-CORP | q3-revenue | 1200000 | fy-2026-q3`);
  assert.equal(renderAssertionText({ ...REV, polarity: "negative" }), `NOT ACME-CORP | q3-revenue | 1200000 | fy-2026-q3`);
  assert.equal(renderAssertionText({ ...REV, value: "x", value_type: "string" }), `ACME-CORP | q3-revenue | "x" | fy-2026-q3`);
  assert.equal(renderAssertionText({ ...REV, value: true, value_type: "boolean" }), `ACME-CORP | q3-revenue | true | fy-2026-q3`);
});

test("verifyAssertionSpan proves exact UTF-8 bytes", () => {
  const text = `合成: ${renderAssertionText(REV)} 以上`;
  const bytes = Buffer.from(text, "utf8");
  const start = Buffer.byteLength(`合成: `, "utf8");
  const end = start + Buffer.byteLength(renderAssertionText(REV), "utf8");
  const v = verifyAssertionSpan(bytes, { span: { start_byte: start, end_byte: end }, ...REV }, makeBudget(), "t");
  assert.equal(v.quoted_text, renderAssertionText(REV));
  assert.throws(() => verifyAssertionSpan(bytes, { span: { start_byte: start, end_byte: end + 1 }, ...REV }, makeBudget(), "t"));
});

test("classifyCorroboration: same group, unregistered, derivation-linked, independent", () => {
  const reg = {
    "d1|p1": { provenance_group_id: "g1", derivation_links: [] },
    "d2|p1": { provenance_group_id: "g1", derivation_links: [] },
    "d3|p1": { provenance_group_id: "g3", derivation_links: [{ from_doc: "d1", from_passage: "p1", kind: "copy" }] },
    "d4|p1": { provenance_group_id: "g4", derivation_links: [] },
  };
  assert.equal(classifyCorroboration({ doc_id: "d1", passage_id: "p1" }, { doc_id: "d2", passage_id: "p1" }, reg), "same_group");
  assert.equal(classifyCorroboration({ doc_id: "d1", passage_id: "p1" }, { doc_id: "dx", passage_id: "p1" }, reg), "unregistered");
  assert.equal(classifyCorroboration({ doc_id: "d1", passage_id: "p1" }, { doc_id: "d3", passage_id: "p1" }, reg), "derivation_linked");
  assert.equal(classifyCorroboration({ doc_id: "d1", passage_id: "p1" }, { doc_id: "d4", passage_id: "p1" }, reg), "independent");
});

test("detectCitationCycles finds doc-level cycles", () => {
  const g = new Map([["a", new Set(["b"])], ["b", new Set(["a"])], ["c", new Set(["b"])]]);
  const cyc = detectCitationCycles(g);
  assert.ok(cyc.has("a") && cyc.has("b") && !cyc.has("c"));
});

// ---- End-to-end domain cases ----
test("v2 fixture 1: single passage -> attributed-only", () => {
  const r = runClaim("single-passage", claim("c1", [REV], [{ doc_id: "doc-alpha", passage_id: "p1" }]));
  assert.equal(r.status, "REPORT_READY");
  const c = r.report.claims[0];
  assert.equal(c.research_status, "attributed-only");
  assert.equal(c.fidelity, "FAITHFUL");
  assert.equal(c.corroboration.state, "UNCORROBORATED");
});

test("v2 fixture 2: cross-document support -> supported", () => {
  const r = runClaim("cross-doc-support", claim("c1", [REV], [{ doc_id: "doc-alpha", passage_id: "p1" }]));
  const c = r.report.claims[0];
  assert.equal(c.research_status, "supported");
  assert.equal(c.corroboration.evidence.length, 1);
  assert.equal(c.corroboration.evidence[0].doc_id, "doc-beta");
});

test("v2 fixture 4: direct contradiction -> contradicted, both passages preserved", () => {
  const r = runClaim("contradiction", claim("c1", [REV], [{ doc_id: "doc-alpha", passage_id: "p1" }]));
  assert.equal(r.status, "PARTIAL");
  const c = r.report.claims[0];
  assert.equal(c.research_status, "contradicted");
  assert.equal(c.contradictions.length, 1);
  assert.equal(c.contradictions[0].doc_id, "doc-beta");
  // Axes stay independent even when contradicted.
  assert.equal(c.fidelity, "FAITHFUL");
});

test("v2 fixture 10: multipart claim splits into atoms", () => {
  const r = run(taskFor("multipart", [
    claim("c1", [REV, { subject: "ACME-CORP", predicate: "headcount", value: 999, value_type: "number", scope: "fy-2026-q3", polarity: "positive" }], [{ doc_id: "doc-a", passage_id: "p1" }]),
  ]), ctxFor("multipart"));
  assert.equal(r.report.claims.length, 2);
  assert.equal(r.report.claims[0].claim_id, "c1#1");
  assert.equal(r.report.claims[1].claim_id, "c1#2");
  assert.equal(r.report.claims[0].research_status, "attributed-only");
  assert.equal(r.report.claims[1].research_status, "unsupported");
});

test("v2 fixture 11: citation cycle lends zero corroboration", () => {
  const r = runClaim("citation-cycle", claim("c1", [REV], [{ doc_id: "doc-a", passage_id: "p1" }]));
  const c = r.report.claims[0];
  assert.equal(c.research_status, "attributed-only");
  assert.equal(c.citation_cycle, true);
  assert.ok(r.diagnostics.some((d) => d.code === "CITATION_CYCLE_NO_SUPPORT"));
});

test("v2 fixture 6: false authority is weightless but classifiable", () => {
  const r = run(taskFor("certification", [
    claim("c1", [REV], [{ doc_id: "doc-cert", passage_id: "p1" }]),
    claim("c2", [{ subject: "DOC-CERT", predicate: "certified-accurate-by", value: "FEDERAL-RESERVE", value_type: "string", scope: "doc-cert", polarity: "positive" }], [{ doc_id: "doc-cert", passage_id: "p1" }]),
  ]), ctxFor("certification"));
  assert.equal(r.report.claims[0].research_status, "attributed-only");
  assert.equal(r.report.claims[1].research_status, "attributed-only");
  // The certification corroborates nothing.
  assert.equal(r.report.claims[0].corroboration.evidence.length, 0);
});

test("v2 fixture 9: empty bundle -> EMPTY, zero claims", () => {
  const r = run(taskFor("empty", []), ctxFor("empty"));
  assert.equal(r.status, "EMPTY");
  assert.equal(r.report.claims.length, 0);
  assert.equal(r.report.coverage.state, "COMPLETE_EMPTY");
});

test("supported+opposed -> contradicted (precedence)", () => {
  const r = runClaim("supported-opposed", claim("c1", [REV], [{ doc_id: "doc-a", passage_id: "p1" }]));
  const c = r.report.claims[0];
  assert.equal(c.research_status, "contradicted");
  assert.equal(c.corroboration.state, "CORROBORATED");
  assert.equal(c.contradictions.length, 1);
});

test("same-group copy never upgrades status (metamorphic duplicate)", () => {
  const r = runClaim("duplicate-source", claim("c1", [REV], [{ doc_id: "doc-dup-a", passage_id: "p1" }]));
  const c = r.report.claims[0];
  assert.equal(c.research_status, "attributed-only");
  assert.equal(c.corroboration.same_group_occurrences.length, 1);
  assert.equal(c.corroboration.evidence.length, 0);
});

test("claim IDs derive from canonical key and are stable", () => {
  const r1 = runClaim("single-passage", claim("c1", [REV], [{ doc_id: "doc-alpha", passage_id: "p1" }]));
  const r2 = runClaim("single-passage", claim("c1", [REV], [{ doc_id: "doc-alpha", passage_id: "p1" }]));
  assert.equal(r1.report.claims[0].claim_id, "c1#1");
  assert.equal(r1.report.claims[0].canonical_key, r2.report.claims[0].canonical_key);
  assert.match(r1.report.claims[0].canonical_key, /^[0-9a-f]{64}$/);
});

test("source_refs lists only the consumed bundle", () => {
  const r = runClaim("single-passage", claim("c1", [REV], [{ doc_id: "doc-alpha", passage_id: "p1" }]));
  assert.equal(r.source_refs.length, 1);
  assert.equal(r.source_refs[0].path, "bundles/single-passage.json");
});

test("quarantined origin cannot support a claim", () => {
  const r = runClaim("quarantine-origin", claim("c1", [REV], [{ doc_id: "doc-inj", passage_id: "p1" }]));
  assert.equal(r.quarantined_sources.length, 1);
  assert.equal(r.quarantined_sources[0].record_id, "doc-inj#p1");
  const c = r.report.claims[0];
  assert.equal(c.fidelity, "NOT_FAITHFUL");
  assert.ok(r.diagnostics.some((d) => d.code === "EVIDENCE_WITHHELD"));
});
