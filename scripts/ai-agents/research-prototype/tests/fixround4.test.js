/** fixround4.test.js — public-runtime regression probes for the carried
 * EXEC652 findings (fix round 4, PR #652):
 *
 *  EXEC652-001: citations carry a pinned passage byte identity
 *    (byte_identity); spans address those pinned bytes, never the bundle
 *    bytes. Canonical claim keys bind the exact source pin + passage
 *    bytes + span.
 *  EXEC652-002: provenance registrations bind exact source pins via
 *    applies_to; reused doc/passage IDs under a changed pin stay
 *    conservative (unregistered).
 *  EXEC652-003: trap-free native Proxy detection (zero trap executions)
 *    before every reflective operation; exact serialized aggregate
 *    accounting for context/registry metadata.
 *  EXEC652-005: empty source reports requested claims unsupported (no
 *    fabricated source); output limits run on the empty path.
 *
 * All probes exercise the actual public run(), never a simulation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { run, BUDGET_LIMITS } from "../src/index.js";
import { makeBudget, BudgetError } from "../src/resolver.js";
import { canonicalJson } from "../src/canonical.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

/** Per-run host registry selection bound to the evaluated bundle pin. */
function registryFor(bundle) {
  const ref = store.bundleRefs[bundle];
  const docs = JSON.parse(store.sources[`${ref.repo}|${ref.path}`].revisions[ref.commit].text);
  const reg = {};
  for (const d of docs) for (const p of d.passages || []) {
    const k = `${d.doc_id}|${p.passage_id}`;
    if (store.provenanceRegistry[k]) {
      reg[k] = { ...store.provenanceRegistry[k], applies_to: [{ ...ref }] };
    }
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
function taskFor(bundle, claims = [], popOverrides = {}) {
  const ref = store.bundleRefs[bundle];
  const n = JSON.parse(store.sources[`${ref.repo}|${ref.path}`].revisions[ref.commit].text).length;
  return {
    schema_version: "1", task_id: "fixround4-test", operation: "analyze",
    fixture_refs: { evidence_bundle: ref },
    options: {
      population: { declared_total: n, complete: true, ...popOverrides },
      requested_claims: claims,
    },
  };
}
const REV = { subject: "ACME-CORP", predicate: "q3-revenue", value: 1200000, value_type: "number", scope: "fy-2026-q3", polarity: "positive" };
const claim = (id, atoms, refs) => ({ claim_id: id, atoms, origin_passage_refs: refs });

/**
 * Independently verify one emitted citation against the bundle bytes:
 * resolve the bundle via the citation's source_ref pin, locate the
 * passage by doc/passage id, check sha256(passage bytes) equals the
 * pinned byte_identity digest, then slice [start_byte, end_byte) and
 * require the exact quoted_span. Returns the slice for assertions.
 */
function verifyCitationSlice(bundleText, docId, passageId, citation) {
  assert.equal(citation.verification, "verified");
  assert.ok(citation.byte_identity, "citation must carry a pinned passage byte identity");
  assert.equal(citation.byte_identity.algorithm, "sha256");
  const docs = JSON.parse(bundleText);
  const doc = docs.find((d) => d.doc_id === docId);
  assert.ok(doc, `doc ${docId} must exist in the bundle`);
  const passage = (doc.passages || []).find((p) => p.passage_id === passageId);
  assert.ok(passage, `passage ${passageId} must exist in doc ${docId}`);
  const passageBytes = Buffer.from(passage.text, "utf8");
  assert.equal(sha256(passage.text), citation.byte_identity.digest, "passage bytes must match the pinned digest");
  assert.equal(passageBytes.length, citation.byte_identity.byte_length);
  const { start_byte, end_byte } = citation.span;
  assert.ok(Number.isInteger(start_byte) && Number.isInteger(end_byte));
  assert.ok(start_byte >= 0 && end_byte <= passageBytes.length && end_byte > start_byte);
  const slice = passageBytes.subarray(start_byte, end_byte).toString("utf8");
  assert.equal(slice, citation.quoted_span, "span bytes must decode to the quoted span");
  assert.equal(citation.span.quoted_text, citation.quoted_span);
  return slice;
}

function bundleTextOf(bundle) {
  const ref = store.bundleRefs[bundle];
  return store.sources[`${ref.repo}|${ref.path}`].revisions[ref.commit].text;
}

// ---------------- EXEC652-001 ----------------

test("EXEC652-001: origin citation independently resolves to the quoted bytes", () => {
  const r = run(taskFor("cross-doc-support", [
    claim("c1", [REV], [{ doc_id: "doc-alpha", passage_id: "p1" }]),
  ]), ctxFor("cross-doc-support"));
  assert.equal(r.status, "REPORT_READY");
  const c = r.report.claims[0];
  assert.equal(c.fidelity, "FAITHFUL");
  const text = bundleTextOf("cross-doc-support");
  const slice = verifyCitationSlice(text, c.origin.doc_id, c.origin.passage_id, c.origin.citation);
  assert.equal(slice, "ACME-CORP | q3-revenue | 1200000 | fy-2026-q3");
  // The old defect: these passage-relative offsets do NOT address the
  // bundle bytes. Slicing the bundle at the same offsets must differ,
  // proving the citation no longer mislabels its coordinate space.
  const bundleBytes = Buffer.from(text, "utf8");
  const { start_byte, end_byte } = c.origin.citation.span;
  const bundleSlice = bundleBytes.subarray(start_byte, Math.min(end_byte, bundleBytes.length)).toString("utf8");
  assert.notEqual(bundleSlice, slice, "span must not be misread as bundle coordinates");
});

test("EXEC652-001: corroboration evidence citation independently resolves", () => {
  const r = run(taskFor("cross-doc-support", [
    claim("c1", [REV], [{ doc_id: "doc-alpha", passage_id: "p1" }]),
  ]), ctxFor("cross-doc-support"));
  const c = r.report.claims[0];
  assert.equal(c.research_status, "supported");
  assert.ok(c.corroboration.evidence.length >= 1);
  const text = bundleTextOf("cross-doc-support");
  for (const e of c.corroboration.evidence) {
    const slice = verifyCitationSlice(text, e.doc_id, e.passage_id, e.citation);
    assert.equal(slice, "ACME-CORP | q3-revenue | 1200000 | fy-2026-q3");
  }
});

test("EXEC652-001: contradiction citation independently resolves", () => {
  const r = run(taskFor("contradiction", [
    claim("c1", [REV], [{ doc_id: "doc-alpha", passage_id: "p1" }]),
  ]), ctxFor("contradiction"));
  const c = r.report.claims[0];
  assert.equal(c.research_status, "contradicted");
  assert.ok(c.contradictions.length >= 1);
  const text = bundleTextOf("contradiction");
  verifyCitationSlice(text, c.origin.doc_id, c.origin.passage_id, c.origin.citation);
  for (const k of c.contradictions) {
    verifyCitationSlice(text, k.doc_id, k.passage_id, k.citation);
  }
});

test("EXEC652-001: Unicode passage citation slices exact UTF-8 bytes", () => {
  const UNI = { subject: "株式会社ACME", predicate: "q3-revenue", value: 1200000, value_type: "number", scope: "fy-2026-q3", polarity: "positive" };
  const r = run(taskFor("unicode", [
    claim("c1", [UNI], [{ doc_id: "doc-uni", passage_id: "p1" }]),
  ]), ctxFor("unicode"));
  assert.equal(r.status, "REPORT_READY");
  const c = r.report.claims[0];
  assert.equal(c.fidelity, "FAITHFUL");
  const text = bundleTextOf("unicode");
  const slice = verifyCitationSlice(text, "doc-uni", "p1", c.origin.citation);
  assert.ok(slice.includes("株式会社ACME"));
  // Byte boundaries are UTF-8 exact: re-encoding the slice must
  // reproduce the pinned bytes (no split multi-byte sequence).
  const passageBytes = Buffer.from(JSON.parse(text)[0].passages[0].text, "utf8");
  const { start_byte, end_byte } = c.origin.citation.span;
  assert.deepEqual(
    Buffer.from(passageBytes.subarray(start_byte, end_byte).toString("utf8"), "utf8"),
    passageBytes.subarray(start_byte, end_byte)
  );
});

test("EXEC652-001: escaped-JSON passage citation slices decoded bytes", () => {
  // Build a bundle whose JSON source uses escapes (quotes, newlines,
  // unicode escapes); the agent verifies against DECODED bytes and the
  // citation must pin those decoded bytes.
  const rawText = 'Lead-in with "quotes" and a newline\nhere, plus snowman ☃ and é.';
  const assertionText = 'ACME-CORP | q3-revenue | 1200000 | fy-2026-q3';
  const passageText = `${rawText} ${assertionText} trailer.`;
  const start = Buffer.byteLength(rawText + " ", "utf8");
  const end = start + Buffer.byteLength(assertionText, "utf8");
  const docs = [{
    record: "document", doc_id: "doc-esc", title: "t",
    passages: [{
      passage_id: "p1", text: passageText,
      assertions: [{
        assertion_id: "a1", subject: "ACME-CORP", predicate: "q3-revenue",
        value: 1200000, value_type: "number", scope: "fy-2026-q3",
        polarity: "positive", span: { start_byte: start, end_byte: end },
      }],
      citations: [],
    }],
  }];
  const text = JSON.stringify(docs); // source carries \" \n \uXXXX escapes
  assert.ok(text.includes("\\n") || text.includes("\\u"), "bundle source must use JSON escapes");
  const textBytes = Buffer.from(text, "utf8");
  const blob = createHash("sha1")
    .update(Buffer.concat([Buffer.from(`blob ${textBytes.length}\0`, "utf8"), textBytes]))
    .digest("hex");
  const commit = "e".repeat(40);
  const ref = { repo: "research-sources", path: "bundles/esc.json", commit, blob, algorithm: "git-sha1", revision: "v1" };
  const key = `${ref.repo}|${ref.path}`;
  const task = {
    schema_version: "1", task_id: "esc-test", operation: "analyze",
    fixture_refs: { evidence_bundle: ref },
    options: {
      population: { declared_total: 1, complete: true },
      requested_claims: [claim("c1", [REV], [{ doc_id: "doc-esc", passage_id: "p1" }])],
    },
  };
  const ctx = {
    clock: 1780315200000,
    sources: { [key]: { revisions: { [commit]: { text, blob, label: "v1", expected_records: 1 } } } },
    readGrants: [{ repo: ref.repo, path: ref.path }],
    principal: store.principals.jason,
    criteria: store.criteriaPresets.standard,
    provenance_registry: {
      "doc-esc|p1": { provenance_group_id: "g-esc", derivation_links: [], applies_to: [{ ...ref }] },
    },
  };
  const r = run(task, ctx);
  assert.equal(r.status, "REPORT_READY");
  const c = r.report.claims[0];
  assert.equal(c.fidelity, "FAITHFUL");
  const slice = verifyCitationSlice(text, "doc-esc", "p1", c.origin.citation);
  assert.equal(slice, assertionText);
});

test("EXEC652-001: changed source identity changes the canonical key; replay is stable", () => {
  const runOnce = (bundle, passageRef) => run(taskFor(bundle, [
    claim("c1", [REV], [passageRef]),
  ]), ctxFor(bundle)).report.claims[0].canonical_key;
  const k1 = runOnce("single-passage", { doc_id: "doc-alpha", passage_id: "p1" });
  const k2 = runOnce("single-passage", { doc_id: "doc-alpha", passage_id: "p1" });
  assert.equal(k1, k2, "byte-identical replay must keep the canonical key stable");
  assert.match(k1, /^[0-9a-f]{64}$/);
  // Same doc/passage IDs, different bundle bytes (different blob):
  // the canonical identity must NOT silently carry over.
  const k3 = runOnce("cross-doc-support", { doc_id: "doc-alpha", passage_id: "p1" });
  assert.notEqual(k1, k3, "changed source pin must change the canonical claim identity");
});

// ---------------- EXEC652-002 ----------------
// Exact-source registration/applicability: a provenance entry applies
// only to its registered source pins. Reused doc/passage IDs under a
// changed pin stay conservative (unregistered => UNCORROBORATED).

/** Build a two-doc bundle (doc-x, doc-y, same assertion) with a chosen pin. */
function twoDocBundle(pin, proseA = "Alpha prose. ", proseB = "Beta prose. ") {
  const mkAssertion = (id) => ({
    assertion_id: id, subject: "ACME-CORP", predicate: "q3-revenue",
    value: 1200000, value_type: "number", scope: "fy-2026-q3", polarity: "positive",
  });
  const mkPassage = (prose, id) => {
    const quoted = "ACME-CORP | q3-revenue | 1200000 | fy-2026-q3";
    const start = Buffer.byteLength(prose, "utf8");
    return {
      passage_id: "p1", text: `${prose}${quoted} tail.`,
      assertions: [{ ...mkAssertion(id), span: { start_byte: start, end_byte: start + Buffer.byteLength(quoted, "utf8") } }],
      citations: [],
    };
  };
  const docs = [
    { record: "document", doc_id: "doc-x", title: "X", passages: [mkPassage(proseA, "ax")] },
    { record: "document", doc_id: "doc-y", title: "Y", passages: [mkPassage(proseB, "ay")] },
  ];
  const text = JSON.stringify(docs);
  const textBytes = Buffer.from(text, "utf8");
  const blob = createHash("sha1")
    .update(Buffer.concat([Buffer.from(`blob ${textBytes.length}\0`, "utf8"), textBytes]))
    .digest("hex");
  return { text, blob };
}

function pinFor(overrides = {}) {
  return {
    repo: "research-sources", path: "bundles/pin-test.json",
    commit: "a".repeat(40), blob: "b".repeat(40),
    algorithm: "git-sha1", revision: "v1", ...overrides,
  };
}

function pinTestContext(bundleText, pin, registry) {
  const key = `${pin.repo}|${pin.path}`;
  return {
    clock: 1780315200000,
    // The revision label tracks the pin's revision so source resolution
    // succeeds; only the REGISTRY applicability is under test.
    sources: { [key]: { revisions: { [pin.commit]: { text: bundleText, blob: pin.blob, label: pin.revision, expected_records: 2 } } } },
    readGrants: [{ repo: pin.repo, path: pin.path }],
    principal: store.principals.jason,
    criteria: store.criteriaPresets.standard,
    provenance_registry: registry,
  };
}

function pinTestTask(pin) {
  return {
    schema_version: "1", task_id: "pin-test", operation: "analyze",
    fixture_refs: { evidence_bundle: { ...pin } },
    options: {
      population: { declared_total: 2, complete: true },
      requested_claims: [claim("c1", [REV], [{ doc_id: "doc-x", passage_id: "p1" }])],
    },
  };
}

test("EXEC652-002: reused IDs under a changed blob stay conservative (no false corroboration)", () => {
  // Registry entry registered for pinA; the consumed bundle has pinB
  // (same doc-x/doc-y passage IDs, different bytes). The entry must
  // NOT apply: doc-y is unregistered => UNCORROBORATED, never
  // independent. Old behavior silently carried the independence
  // metadata forward and reported "supported".
  const pinA = pinFor({ blob: "a".repeat(40) });
  const { text, blob } = twoDocBundle(pinA);
  const pinB = pinFor({ blob });
  const registry = {
    "doc-x|p1": { provenance_group_id: "g-x", derivation_links: [], applies_to: [{ ...pinA }] },
    "doc-y|p1": { provenance_group_id: "g-y", derivation_links: [], applies_to: [{ ...pinA }] },
  };
  const r = run(pinTestTask(pinB), pinTestContext(text, pinB, registry));
  assert.equal(r.status, "REPORT_READY");
  const c = r.report.claims[0];
  assert.equal(c.fidelity, "FAITHFUL");
  assert.equal(c.corroboration.state, "UNCORROBORATED");
  assert.equal(c.corroboration.evidence.length, 0);
  assert.equal(c.corroboration.unregistered_candidates.length, 1);
  assert.equal(c.research_status, "attributed-only", "must not upgrade to supported on a non-applicable registration");
});

test("EXEC652-002: matching pin keeps genuine independent corroboration", () => {
  const pin = pinFor({});
  const { text, blob } = twoDocBundle(pin);
  const pinReal = { ...pin, blob };
  const registry = {
    "doc-x|p1": { provenance_group_id: "g-x", derivation_links: [], applies_to: [{ ...pinReal }] },
    "doc-y|p1": { provenance_group_id: "g-y", derivation_links: [], applies_to: [{ ...pinReal }] },
  };
  const r = run(pinTestTask(pinReal), pinTestContext(text, pinReal, registry));
  assert.equal(r.status, "REPORT_READY");
  const c = r.report.claims[0];
  assert.equal(c.corroboration.state, "CORROBORATED");
  assert.equal(c.corroboration.evidence.length, 1);
  assert.equal(c.research_status, "supported");
});

test("EXEC652-002: transitive copy defeat preserved under matching pins", () => {
  const pin = pinFor({});
  const { text, blob } = twoDocBundle(pin);
  const pinReal = { ...pin, blob };
  const registry = {
    "doc-x|p1": { provenance_group_id: "g-x", derivation_links: [], applies_to: [{ ...pinReal }] },
    "doc-y|p1": {
      provenance_group_id: "g-y",
      derivation_links: [{ from_doc: "doc-x", from_passage: "p1", kind: "copy" }],
      applies_to: [{ ...pinReal }],
    },
  };
  const r = run(pinTestTask(pinReal), pinTestContext(text, pinReal, registry));
  const c = r.report.claims[0];
  assert.equal(c.corroboration.derivation_linked_candidates.length, 1);
  assert.equal(c.corroboration.state, "UNCORROBORATED");
  assert.equal(c.research_status, "attributed-only");
});

test("EXEC652-002: changed commit/path/revision each defeat applicability", () => {
  const pinA = pinFor({ commit: "a".repeat(40), path: "bundles/pin-test.json", revision: "v1" });
  const { text, blob } = twoDocBundle(pinA);
  const base = { ...pinA, blob };
  const variants = [
    pinFor({ commit: "c".repeat(40), blob }),   // changed commit
    pinFor({ path: "bundles/other.json", blob }), // changed path
    pinFor({ revision: "v2", blob }),          // changed revision
  ];
  for (const pinV of variants) {
    const registry = {
      "doc-x|p1": { provenance_group_id: "g-x", derivation_links: [], applies_to: [{ ...pinA, blob }] },
      "doc-y|p1": { provenance_group_id: "g-y", derivation_links: [], applies_to: [{ ...pinA, blob }] },
    };
    const r = run(pinTestTask(pinV), pinTestContext(text, pinV, registry));
    const c = r.report.claims[0];
    assert.equal(c.corroboration.state, "UNCORROBORATED", `changed pin ${JSON.stringify(pinV)} must not apply`);
    assert.equal(c.research_status, "attributed-only");
  }
  // Sanity: the exact pin still applies.
  const registry = {
    "doc-x|p1": { provenance_group_id: "g-x", derivation_links: [], applies_to: [{ ...base }] },
    "doc-y|p1": { provenance_group_id: "g-y", derivation_links: [], applies_to: [{ ...base }] },
  };
  const r = run(pinTestTask(base), pinTestContext(text, base, registry));
  assert.equal(r.report.claims[0].research_status, "supported");
});

// ---------------- EXEC652-003 ----------------
// Trap-free native Proxy detection: every trap counter must stay at
// zero — top-level, nested, and selected-source — and the run must
// refuse INVALID_INPUT with no partial domain artifact.

function instrumentedProxy(target, counters) {
  const traps = [
    "getPrototypeOf", "setPrototypeOf", "isExtensible", "preventExtensions",
    "getOwnPropertyDescriptor", "defineProperty", "has", "get", "set",
    "deleteProperty", "ownKeys", "apply", "construct",
  ];
  const handler = {};
  for (const t of traps) {
    counters[t] = 0;
    handler[t] = (...args) => { counters[t]++; return Reflect[t](...args); };
  }
  return new Proxy(target, handler);
}
function totalTraps(counters) {
  return Object.values(counters).reduce((a, b) => a + b, 0);
}
function proxyClaimBundle() {
  return {
    schema_version: "1", task_id: "proxy-test", operation: "analyze",
    fixture_refs: { evidence_bundle: { ...store.bundleRefs["single-passage"] } },
    options: {
      population: { declared_total: 1, complete: true },
      requested_claims: [claim("c1", [REV], [{ doc_id: "doc-alpha", passage_id: "p1" }])],
    },
  };
}

test("EXEC652-003: top-level Proxy task fires zero traps and refuses", () => {
  const counters = {};
  const proxyTask = instrumentedProxy(proxyClaimBundle(), counters);
  const r = run(proxyTask, ctxFor("single-passage"));
  assert.equal(totalTraps(counters), 0, `traps fired: ${JSON.stringify(counters)}`);
  assert.equal(r.status, "REFUSED");
  assert.ok(r.diagnostics.some((d) => d.code === "INVALID_INPUT"));
  assert.equal(r.report, null);
  assert.equal(r.complete, false);
});

test("EXEC652-003: nested Proxy claim fires zero traps and refuses", () => {
  const counters = {};
  const task = proxyClaimBundle();
  task.options.requested_claims = [instrumentedProxy(task.options.requested_claims[0], counters)];
  const r = run(task, ctxFor("single-passage"));
  assert.equal(totalTraps(counters), 0, `traps fired: ${JSON.stringify(counters)}`);
  assert.equal(r.status, "REFUSED");
  assert.ok(r.diagnostics.some((d) => d.code === "INVALID_INPUT"));
  assert.equal(r.report, null);
});

test("EXEC652-003: Proxy selected-source entry fires zero traps and refuses", () => {
  const counters = {};
  const ref = store.bundleRefs["single-passage"];
  const key = `${ref.repo}|${ref.path}`;
  const realEntry = store.sources[key];
  const proxyEntry = instrumentedProxy(realEntry, counters);
  const ctx = ctxFor("single-passage", { sources: { [key]: proxyEntry } });
  const r = run(proxyClaimBundle(), ctx);
  assert.equal(totalTraps(counters), 0, `traps fired: ${JSON.stringify(counters)}`);
  assert.equal(r.status, "REFUSED");
  assert.ok(r.diagnostics.some((d) => d.code === "INVALID_INPUT"));
  assert.equal(r.report, null);
});

test("EXEC652-003: top-level Proxy context fires zero traps and refuses", () => {
  const counters = {};
  const ctx = instrumentedProxy(ctxFor("single-passage"), counters);
  const r = run(proxyClaimBundle(), ctx);
  assert.equal(totalTraps(counters), 0, `traps fired: ${JSON.stringify(counters)}`);
  assert.equal(r.status, "REFUSED");
  assert.ok(r.diagnostics.some((d) => d.code === "INVALID_INPUT"));
  assert.equal(r.report, null);
});

test("EXEC652-003: Proxy inside provenance registry fires zero traps and refuses", () => {
  const counters = {};
  const ctx = ctxFor("single-passage");
  const reg = ctx.provenance_registry;
  const firstKey = Object.keys(reg)[0];
  reg[firstKey] = instrumentedProxy(reg[firstKey], counters);
  const r = run(proxyClaimBundle(), ctx);
  assert.equal(totalTraps(counters), 0, `traps fired: ${JSON.stringify(counters)}`);
  assert.equal(r.status, "REFUSED");
  assert.ok(r.diagnostics.some((d) => d.code === "INVALID_INPUT"));
  assert.equal(r.report, null);
});

// ---- EXEC652-003: exact serialized aggregate accounting ----

test("EXEC652-003: countSerialized charges escaped/structure bytes, not raw strings", () => {
  const b = makeBudget();
  const value = { label: 'a"b\nc☃', repo: "r" };
  b.countSerialized(value, "t");
  const expected = Buffer.byteLength(canonicalJson(value), "utf8");
  assert.equal(b.used.payloadBytes, expected);
  // Escaping + structure cost real bytes: strictly more than the raw
  // string lengths the old implementation added.
  const raw = Buffer.byteLength('a"b\nc☃', "utf8") + Buffer.byteLength("r", "utf8");
  assert.ok(expected > raw, "serialized form must exceed raw string lengths");
});

test("EXEC652-003: countSerialized exact-fit and +1", () => {
  const b = makeBudget();
  const room = BUDGET_LIMITS.maxPayloadBytes;
  // canonicalJson("xxx...") = '"' + content + '"' -> content length room-2 fits exactly.
  b.countSerialized("x".repeat(room - 2), "exact-fit");
  assert.equal(b.used.payloadBytes, room);
  assert.throws(
    () => b.countSerialized("y", "plus-one"),
    (e) => e instanceof BudgetError && e.code === "INPUT_LIMIT"
  );
});

test("EXEC652-003: escaped source label flows through serialized accounting", () => {
  // A revision label with quotes/newlines/unicode is admitted and
  // charged in serialized (escaped) form; the run completes normally.
  const ref = store.bundleRefs["single-passage"];
  const key = `${ref.repo}|${ref.path}`;
  const srcEntry = JSON.parse(JSON.stringify(store.sources[key]));
  const rev = srcEntry.revisions[ref.commit];
  const escLabel = 'v1 "quoted"\nline2 ☃';
  rev.label = escLabel;
  const ctx = ctxFor("single-passage", { sources: { [key]: srcEntry } });
  const task = taskFor("single-passage", [claim("c1", [REV], [{ doc_id: "doc-alpha", passage_id: "p1" }])]);
  task.fixture_refs.evidence_bundle = { ...ref, revision: escLabel };
  const r = run(task, ctx);
  assert.equal(r.status, "REPORT_READY");
  assert.equal(r.report.claims[0].research_status, "attributed-only");
});

// ---------------- EXEC652-005 ----------------
// Empty source: zero extracted claims AND requested claims reported
// unsupported — no fabricated supporting source. Output limits run on
// the empty path too.

test("EXEC652-005: known-empty with requested claims reports them unsupported", () => {
  const r = run(taskFor("empty", [
    claim("c1", [REV], [{ doc_id: "doc-x", passage_id: "p1" }]),
  ]), ctxFor("empty"));
  assert.equal(r.status, "EMPTY");
  assert.equal(r.report.coverage.state, "COMPLETE_EMPTY");
  assert.equal(r.report.claims.length, 1);
  const c = r.report.claims[0];
  assert.equal(c.claim_id, "c1#1");
  assert.equal(c.fidelity, "NOT_FAITHFUL");
  assert.equal(c.corroboration.state, "UNCORROBORATED");
  assert.equal(c.research_status, "unsupported");
  // No fabricated supporting source: the origin names no passage and
  // carries a null citation.
  assert.equal(c.origin.citation, null);
  assert.ok(!("doc_id" in c.origin), "origin must not name a passage");
  assert.ok(!("passage_id" in c.origin), "origin must not name a passage");
  assert.deepEqual(c.corroboration.evidence, []);
  assert.deepEqual(c.contradictions, []);
  assert.match(c.canonical_key, /^[0-9a-f]{64}$/);
  assert.equal(r.report.summary, null);
});

test("EXEC652-005: known-empty without requested claims keeps zero claims", () => {
  const r = run(taskFor("empty", []), ctxFor("empty"));
  assert.equal(r.status, "EMPTY");
  assert.equal(r.report.claims.length, 0);
  assert.equal(r.report.coverage.state, "COMPLETE_EMPTY");
});

test("EXEC652-005: unknown-empty with requested claims stays conservative", () => {
  // Population not verified (declared_total mismatch): coverage is
  // UNKNOWN_EMPTY, but requested claims are still each reported
  // unsupported — never silently dropped.
  const r = run(
    taskFor("empty", [claim("c1", [REV], [{ doc_id: "doc-x", passage_id: "p1" }])], { declared_total: 5, complete: true }),
    ctxFor("empty")
  );
  assert.equal(r.status, "EMPTY");
  assert.equal(r.report.coverage.state, "UNKNOWN_EMPTY");
  assert.equal(r.complete, false);
  assert.equal(r.report.claims.length, 1);
  assert.equal(r.report.claims[0].research_status, "unsupported");
  assert.equal(r.report.claims[0].fidelity, "NOT_FAITHFUL");
});

test("EXEC652-005: unknown-empty without requested claims", () => {
  const r = run(taskFor("empty", [], { complete: false }), ctxFor("empty"));
  assert.equal(r.status, "EMPTY");
  assert.equal(r.report.coverage.state, "UNKNOWN_EMPTY");
  assert.equal(r.report.claims.length, 0);
});

test("EXEC652-005: output limits run on the empty path", () => {
  // Enough requested claims on an empty bundle to overflow the output
  // record bound (via host prefill): must refuse OUTPUT_LIMIT with
  // report:null — never a partial domain artifact.
  const claims = Array.from({ length: 10 }, (_, i) =>
    claim(`c${i}`, [REV], [{ doc_id: "doc-x", passage_id: "p1" }]));
  const r = run(taskFor("empty", claims), ctxFor("empty", {
    test_hooks: { prefill_output_records: 1024 },
  }));
  assert.equal(r.status, "REFUSED");
  assert.equal(r.report, null);
  assert.equal(r.complete, false);
  assert.ok(r.diagnostics.some((d) => d.code === "OUTPUT_LIMIT"));
});

test("EXEC652-005: multi-atom requested claims each survive the empty path", () => {
  const r = run(taskFor("empty", [
    claim("c1", [REV, { ...REV, value: 999 }], [{ doc_id: "doc-x", passage_id: "p1" }]),
  ]), ctxFor("empty"));
  assert.equal(r.status, "EMPTY");
  assert.equal(r.report.claims.length, 2);
  assert.equal(r.report.claims[0].claim_id, "c1#1");
  assert.equal(r.report.claims[1].claim_id, "c1#2");
  for (const c of r.report.claims) {
    assert.equal(c.research_status, "unsupported");
    assert.equal(c.origin.citation, null);
  }
});
