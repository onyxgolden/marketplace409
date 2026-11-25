/**
 * budget-sentinels.test.js — the budget-sentinel contract, proven through the
 * Document Agent prototype's public run() path.
 *
 * FORGE-P-20261015-CHATGPT-BUDGET-SENTINELS (bundle row 4). Tests/fixtures
 * only: nothing here changes any agent's budget semantics, classification
 * rules or authorization policy (condition 1). Each agent copies/adapts
 * these probes under its own authenticated manifest (condition 5).
 *
 * What this file proves (one monotonic public-path budget for task plus
 * trusted context; every candidate charged BEFORE its fields are read):
 *   - throwing Proxy/getter tails past the object cap are never read
 *     (registry entries, revisions, grants);
 *   - structurally poisoned nested records past the cap are never
 *     validated (sections, assertions);
 *   - trusted-looking context is charged on the SAME budget as task
 *     content (#632 case);
 *   - exact-limit/+1 object, payload, span and output cases through run();
 *   - a fully valid in-budget bundle still PASSES (negative control).
 *
 * Runner: node --test (like every sibling prototype suite — vitest
 * reports "No test suite found" for these node:test files, pre-existing
 * on main). `node scripts/ai-agents/budget-sentinels/tests/run-tests.js`
 * or `node --test scripts/ai-agents/budget-sentinels/tests/budget-sentinels.test.js`.
 *
 * Charge arithmetic used by the exact-boundary cases (custom sets are
 * registered as an EXTRA REVISION on the existing single-nominal source
 * entry, so no new entry or grant is charged for the set itself):
 *   validateContext on the single-nominal base = 11 object charges
 *     (3 source entries + 3 revisions + 3 grants + principal + criteria),
 *   +1 for the extra set revision = 12; checklist resolve 13; set resolve
 *   14; document charge 15; nested section/assertion [i] charge 16+i;
 *   content resolve after the loops. So a 48-entry nested family peaks at
 *   exactly 64 (content resolve), and the 49th valid entry + a poisoned
 *   50th entry trips the cap on the poison's own charge (65).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run, BUDGET_LIMITS } from "../../document-prototype/src/index.js";
import { gitBlobId, canonicalByteLength } from "../../document-prototype/src/canonical.js";
import { buildContext } from "../../document-prototype/tests/harness.js";
import {
  makeThrowingProxyTail,
  makeThrowingGetterTail,
  structuralKeys,
  descriptorOf,
  hasAccessor,
  rawSpan,
  fillerCommit,
  fillerText,
} from "../sentinel-fixtures.js";

const PROTO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "document-prototype");
const store = JSON.parse(readFileSync(join(PROTO_ROOT, "fixtures", "store.json"), "utf8"));
const gitBlob = (text) => gitBlobId(Buffer.from(text, "utf8"));

const CONTENT_REF = {
  repo: "edu-sources",
  path: "content/d-0001-1.txt",
  commit: "fca5f9b5c675823df529b1c6a1979d50894f5140",
  blob: "8ac8535b7d117f727c7ec454ccf002a978b7c0d7",
  algorithm: "git-sha1",
  revision: "v1",
};

function ctxFor(setName, extra = {}) {
  return buildContext(PROTO_ROOT, { clock: "2026-07-01T00:00:00Z", documentSetRef: store.documentSetRefs[setName], ...extra });
}

function taskForSet(ref, declaredTotal) {
  return {
    schema_version: "1",
    task_id: "t-budget-sentinels",
    operation: "analyze",
    fixture_refs: { document_set: ref },
    options: { population: { declared_total: declaredTotal, complete: true } },
  };
}

function taskFor(setName, declaredTotal) {
  return taskForSet(store.documentSetRefs[setName], declaredTotal);
}

/**
 * Register a custom document set as an EXTRA REVISION on the existing
 * single-nominal source entry. No new source entry, no new grant: the
 * grant already covers repo+path, so the set costs exactly +1 object
 * charge (its revision) in validateContext. The set object itself is
 * stringified BEFORE any poison is spliced in — JSON.stringify of a
 * poisoned value would trip the tail in setup (see sentinel-fixtures.js).
 */
function withCustomSet(base, setObj, key) {
  const text = JSON.stringify(setObj);
  const commit = fillerCommit(key);
  const ref = {
    repo: "edu-sources",
    path: "document-sets/single-nominal.json",
    commit,
    blob: gitBlob(text),
    algorithm: "git-sha1",
    revision: "v1",
  };
  const entryKey = "edu-sources|document-sets/single-nominal.json";
  const sources = {
    ...base.sources,
    [entryKey]: { revisions: { ...base.sources[entryKey].revisions, [commit]: { text, blob: ref.blob } } },
  };
  return { context: { ...base, sources }, ref };
}

function nominalDoc(sections = []) {
  return {
    doc_id: "d-0001",
    logical_id: "spec-alpha",
    revision: 1,
    declared_date: "2026-01-01",
    metadata: { author: "J. Author", date: "2026-01-01", id: "DOC-0001", status: "draft" },
    content_ref: CONTENT_REF,
    sections,
    markers: [],
    references: [],
  };
}

const validSection = (i) => ({ section_id: `s${String(i).padStart(3, "0")}`, start_byte: i, end_byte: i + 1 });
const validAssertion = (i) => ({
  assertion_id: `a-${String(i).padStart(3, "0")}`,
  doc_id: "d-0001",
  subject: "spec",
  property: "text",
  scope: "doc",
  value_type: "STRING",
  value: `v${i}`,
  span: { start_byte: 0, end_byte: 1 },
});

/** Mirror of the output gate's record counting in src/index.js. */
function outputRecordsOf(result) {
  const r = result.report;
  return (
    r.inventory.length +
    r.duplicate_groups.length +
    r.version_conflicts.length +
    r.checklist_results.required_sections.length +
    r.checklist_results.required_companions.length +
    r.reference_edges.length +
    r.cycles.length +
    r.cross_document_conflicts.length +
    r.excluded_ids.length +
    r.excluded_assertions.length +
    result.diagnostics.length +
    result.quarantined_sources.length +
    result.routing_flags.length +
    result.source_refs.length
  );
}

// ---------------------------------------------------------------------
// Condition 2: setup itself must never trip a tail.
// ---------------------------------------------------------------------

test("setup safety: arranging throwing tails never reads them (descriptor-safe setup)", () => {
  const proxy = makeThrowingProxyTail("setup-check");
  const getter = makeThrowingGetterTail(["text", "blob"], "setup-check");
  assert.equal(proxy.touched(), false);
  assert.equal(getter.touched(), false);
  // Descriptor-safe inspection reads no values.
  assert.deepEqual(structuralKeys(getter.value).sort(), ["blob", "text"]);
  assert.equal(hasAccessor(getter.value, "text"), true);
  assert.equal(descriptorOf(getter.value, "text").enumerable, true);
  assert.equal(proxy.touched(), false);
  assert.equal(getter.touched(), false);
  // rawSpan yields offsets only, never decodes.
  assert.deepEqual(rawSpan(0, 50), { start_byte: 0, end_byte: 50 });
  assert.throws(() => rawSpan(5, 5), /end_byte/);
  assert.equal(fillerCommit("x"), fillerCommit("x"));
  assert.equal(fillerText(3), "xxx");
});

// ---------------------------------------------------------------------
// Live tails past the cap: registry entries, revisions, grants.
// The DOC-002R pattern: generous fillers so the cap trips before the
// poison is reached; the touched() flag — not the refusal alone — is the
// proof the poison was never read (a refusal for the wrong reason, e.g.
// a schema cap, would still leave touched() false only if setup was
// clean; the refusal code pins the reason to the object budget).
// ---------------------------------------------------------------------

function fillerSources(count, seedPrefix) {
  const extraSources = {};
  const extraGrants = [];
  for (let i = 0; i < count; i++) {
    const path = `filler/${String(i).padStart(4, "0")}.md`;
    const commit = fillerCommit(`${seedPrefix}-${i}`);
    extraSources[`edu-sources|${path}`] = { revisions: { [commit]: { text: "filler", blob: "a".repeat(40) } } };
    extraGrants.push({ repo: "edu-sources", path });
  }
  return { extraSources, extraGrants };
}

test("getter tail: registry revision past the object cap is never read", () => {
  const base = ctxFor("single-nominal");
  const poison = makeThrowingGetterTail(["text", "blob"], "registry revision");
  const { extraSources, extraGrants } = fillerSources(30, "getter-revision");
  const poisonCommit = fillerCommit("getter-revision-poison");
  extraSources["edu-sources|poison/zzzz.md"] = { revisions: { [poisonCommit]: poison.value } };
  extraGrants.push({ repo: "edu-sources", path: "poison/zzzz.md" });
  const context = { ...base, sources: { ...base.sources, ...extraSources }, readGrants: [...base.readGrants, ...extraGrants] };
  assert.equal(poison.touched(), false, "setup must not trip the tail");
  const result = run(taskFor("single-nominal", 1), context);
  assert.equal(result.status, "REFUSED");
  assert.equal(result.diagnostics[0].code, "BUDGET_EXCEEDED");
  assert.equal(poison.touched(), false, "the poisoned revision past the cap must never be read, not just never used");
});

test("proxy tail: registry revision past the object cap is never read", () => {
  const base = ctxFor("single-nominal");
  const poison = makeThrowingProxyTail("registry revision");
  const { extraSources, extraGrants } = fillerSources(30, "proxy-revision");
  const poisonCommit = fillerCommit("proxy-revision-poison");
  extraSources["edu-sources|poison/zzzz.md"] = { revisions: { [poisonCommit]: poison.value } };
  extraGrants.push({ repo: "edu-sources", path: "poison/zzzz.md" });
  const context = { ...base, sources: { ...base.sources, ...extraSources }, readGrants: [...base.readGrants, ...extraGrants] };
  assert.equal(poison.touched(), false, "setup must not trip the tail");
  const result = run(taskFor("single-nominal", 1), context);
  assert.equal(result.status, "REFUSED");
  assert.equal(result.diagnostics[0].code, "BUDGET_EXCEEDED");
  assert.equal(poison.touched(), false, "the poisoned revision past the cap must never be read, not just never used");
});

test("getter tail: registry entry past the object cap is never read", () => {
  const base = ctxFor("single-nominal");
  const poison = makeThrowingGetterTail(["revisions"], "registry entry");
  const { extraSources } = fillerSources(30, "getter-entry");
  extraSources["edu-sources|poison/zzzz.md"] = poison.value;
  const context = { ...base, sources: { ...base.sources, ...extraSources } };
  assert.equal(poison.touched(), false, "setup must not trip the tail");
  const result = run(taskFor("single-nominal", 1), context);
  assert.equal(result.status, "REFUSED");
  assert.equal(result.diagnostics[0].code, "BUDGET_EXCEEDED");
  assert.equal(poison.touched(), false, "the poisoned registry entry past the cap must never be read, not just never used");
});

test("getter tail: read grant past the object cap is never read", () => {
  const base = ctxFor("single-nominal");
  const poison = makeThrowingGetterTail(["repo", "path"], "read grant");
  const extraGrants = [];
  for (let i = 0; i < 100; i++) {
    extraGrants.push({ repo: "edu-sources", path: `filler-grant/${String(i).padStart(4, "0")}.md` });
  }
  const context = { ...base, readGrants: [...base.readGrants, ...extraGrants, poison.value] };
  assert.equal(poison.touched(), false, "setup must not trip the tail");
  const result = run(taskFor("single-nominal", 1), context);
  assert.equal(result.status, "REFUSED");
  assert.equal(result.diagnostics[0].code, "BUDGET_EXCEEDED");
  assert.equal(poison.touched(), false, "the poisoned read grant past the cap must never be read, not just never used");
});

// ---------------------------------------------------------------------
// Negative control (condition 4): a fully valid in-budget bundle passes.
// ---------------------------------------------------------------------

test("negative control: a fully valid in-budget bundle passes (sentinel must not refuse everything)", () => {
  const result = run(taskFor("single-nominal", 1), ctxFor("single-nominal"));
  assert.equal(result.status, "REPORT_READY");
  assert.equal(result.report.coverage.admitted_count, 1);
});

// ---------------------------------------------------------------------
// Nested records: sections and assertions.
// Live tails cannot reach nested families through run() — the document
// set arrives as JSON text, and the JSON round-trip strips getters and
// Proxies. The sentinel proof for nested families is therefore a
// STRUCTURAL poison: an entry past the cap that is invalid on its face.
// If it were ever validated, the document/assertion would go malformed
// (excluded_*) and the run would NOT refuse — so REFUSED + BUDGET_EXCEEDED
// with empty excluded_* proves it was never inspected at all.
// ---------------------------------------------------------------------

test("nested sections: 48 valid sections pass at exactly the object cap", () => {
  const base = ctxFor("single-nominal");
  const sections = [];
  for (let i = 0; i < 48; i++) sections.push(validSection(i));
  const { context, ref } = withCustomSet(base, { documents: [nominalDoc(sections)], assertions: [] }, "sections-48");
  const result = run(taskForSet(ref, 1), context);
  assert.equal(result.status, "REPORT_READY");
});

test("nested sections: structurally poisoned section past the cap is never validated", () => {
  const base = ctxFor("single-nominal");
  const sections = [];
  for (let i = 0; i < 49; i++) sections.push(validSection(i));
  sections.push({ start_byte: "not-a-number", end_byte: 999999 }); // missing section_id, wrong types
  const { context, ref } = withCustomSet(base, { documents: [nominalDoc(sections)], assertions: [] }, "sections-poison");
  const result = run(taskForSet(ref, 1), context);
  assert.equal(result.status, "REFUSED");
  assert.equal(result.diagnostics[0].code, "BUDGET_EXCEEDED");
  assert.match(result.diagnostics[0].reason, /remaining documents/);
  assert.deepEqual(result.report.excluded_ids, [], "the poisoned section must never become a malformed record");
});

test("nested assertions: 48 valid assertions pass at exactly the object cap", () => {
  const base = ctxFor("single-nominal");
  const assertions = [];
  for (let i = 0; i < 48; i++) assertions.push(validAssertion(i));
  const { context, ref } = withCustomSet(base, { documents: [nominalDoc()], assertions }, "assertions-48");
  const result = run(taskForSet(ref, 1), context);
  assert.equal(result.status, "REPORT_READY");
});

test("nested assertions: structurally poisoned assertion past the cap is never validated", () => {
  const base = ctxFor("single-nominal");
  const assertions = [];
  for (let i = 0; i < 49; i++) assertions.push(validAssertion(i));
  assertions.push({ doc_id: "d-0001", subject: "spec" }); // missing assertion_id + most fields
  const { context, ref } = withCustomSet(base, { documents: [nominalDoc()], assertions }, "assertions-poison");
  const result = run(taskForSet(ref, 1), context);
  assert.equal(result.status, "REFUSED");
  assert.equal(result.diagnostics[0].code, "BUDGET_EXCEEDED");
  assert.match(result.diagnostics[0].reason, /remaining assertions/);
  assert.deepEqual(result.report.excluded_assertions, [], "the poisoned assertion must never become a malformed record");
});

// ---------------------------------------------------------------------
// Trusted context (condition 3 / #632 case): trusted-looking context
// must still be charged on the SAME monotonic budget as task content.
// The Customer Success defect was an unused oversized revision in the
// trusted registry that cost nothing; the Document Agent's DOC-002 was
// the same shape (validateContext enumerated sources/revisions/grants
// before the budget saw them). These prove the fix holds.
// ---------------------------------------------------------------------

test("trusted context: trusted filler sources share the task budget (#632)", () => {
  const base = ctxFor("single-nominal");
  const extraSources = {};
  for (let i = 0; i < 25; i++) {
    const path = `trusted-filler/${String(i).padStart(4, "0")}.md`;
    extraSources[`edu-sources|${path}`] = {
      revisions: { [fillerCommit(`trusted-${i}`)]: { text: "trusted filler", blob: "a".repeat(40) } },
    };
  }
  const context = { ...base, sources: { ...base.sources, ...extraSources } };
  const result = run(taskFor("single-nominal", 1), context);
  assert.equal(result.status, "REFUSED");
  assert.equal(result.diagnostics[0].code, "BUDGET_EXCEEDED");
  assert.match(result.diagnostics[0].reason, /remaining documents/);
  // Control: the same task without the trusted fillers passes.
  const control = run(taskFor("single-nominal", 1), base);
  assert.equal(control.status, "REPORT_READY");
});

test("trusted context: an unused oversized trusted revision is charged (DOC-002 exact reproduction)", () => {
  const base = ctxFor("single-nominal");
  const bigText = fillerText(300000);
  const commit = fillerCommit("trusted-big");
  const context = {
    ...base,
    sources: {
      ...base.sources,
      "edu-sources|trusted-big.md": { revisions: { [commit]: { text: bigText, blob: gitBlob(bigText) } } },
    },
  };
  const result = run(taskFor("single-nominal", 1), context);
  assert.equal(result.status, "REFUSED");
  assert.equal(result.diagnostics[0].code, "INPUT_LIMIT");
});

// ---------------------------------------------------------------------
// Output cases through run().
// A citation carries each quoted byte TWICE (quoted_span AND
// span.quoted_text), so the output byte count has odd parity: the
// largest passing envelope is 262143 bytes and one more quoted byte
// (262145) refuses. The pair below pins the boundary exactly; the
// one-byte step is on the small span so the large spans stay fixed.
// ---------------------------------------------------------------------

function buildOutputCase(L, smallSpan) {
  const base = ctxFor("single-nominal");
  const text = fillerText(L, "a");
  const commit = fillerCommit(`output-content-${L}-${smallSpan}`);
  const contentRef = {
    repo: "edu-sources",
    path: "content/probe-e.txt",
    commit,
    blob: gitBlob(text),
    algorithm: "git-sha1",
    revision: "v1",
  };
  const mkDoc = (id, logical) => ({
    doc_id: id,
    logical_id: logical,
    revision: 1,
    declared_date: "2026-01-01",
    metadata: { author: "J. Author", date: "2026-01-01", id: id === "d-0001" ? "DOC-0001" : "DOC-0002", status: "draft" },
    content_ref: contentRef,
    sections: [],
    markers: [],
    references: [],
  });
  const setObj = {
    documents: [mkDoc("d-0001", "spec-alpha"), mkDoc("d-0002", "spec-beta")],
    assertions: [
      { assertion_id: "a-1", doc_id: "d-0001", subject: "spec", property: "text", scope: "doc", value_type: "STRING", value: "v1", span: { start_byte: 0, end_byte: L } },
      { assertion_id: "a-2", doc_id: "d-0001", subject: "spec", property: "text", scope: "doc", value_type: "STRING", value: "v2", span: { start_byte: 0, end_byte: smallSpan } },
      { assertion_id: "a-3", doc_id: "d-0002", subject: "spec", property: "text", scope: "doc", value_type: "STRING", value: "v3", span: { start_byte: 0, end_byte: L } },
      { assertion_id: "a-4", doc_id: "d-0002", subject: "spec", property: "text", scope: "doc", value_type: "STRING", value: "v4", span: { start_byte: 0, end_byte: L } },
    ],
  };
  const { context, ref } = withCustomSet(base, setObj, `output-${L}-${smallSpan}`);
  context.sources = {
    ...context.sources,
    "edu-sources|content/probe-e.txt": { revisions: { [commit]: { text, blob: contentRef.blob } } },
  };
  context.readGrants = [...context.readGrants, { repo: "edu-sources", path: "content/probe-e.txt" }];
  return { context, ref };
}

test("output bytes: exact limit passes (262143 bytes, the largest odd envelope under the 256 KiB cap)", () => {
  const { context, ref } = buildOutputCase(42880, 100);
  const result = run(taskForSet(ref, 2), context);
  assert.equal(result.status, "REPORT_READY");
  assert.equal(canonicalByteLength(result), 262143);
});

test("output bytes: one more quoted byte refuses OUTPUT_LIMIT (262145 bytes)", () => {
  const { context, ref } = buildOutputCase(42880, 101);
  const result = run(taskForSet(ref, 2), context);
  assert.equal(result.status, "REFUSED");
  assert.equal(result.diagnostics[0].code, "OUTPUT_LIMIT");
});

test("output records: the records gate is unreachable through run() — the object budget binds first", () => {
  // The maximal passing bundle (48-section control): every output record
  // traces to a charged candidate (one inventory item per charged
  // document, one edge per charged reference, one source_ref per charged
  // resolution), plus a fixed handful of checklist terms — so records
  // stay far under the 256-record cap while objects are already at 64.
  const base = ctxFor("single-nominal");
  const sections = [];
  for (let i = 0; i < 48; i++) sections.push(validSection(i));
  const { context, ref } = withCustomSet(base, { documents: [nominalDoc(sections)], assertions: [] }, "records-48");
  const result = run(taskForSet(ref, 1), context);
  assert.equal(result.status, "REPORT_READY");
  assert.ok(
    outputRecordsOf(result) < BUDGET_LIMITS.maxOutputRecords,
    `maximal passing bundle has ${outputRecordsOf(result)} records, under the ${BUDGET_LIMITS.maxOutputRecords} cap`,
  );
  // And one more candidate refuses on OBJECTS, not on records: growth
  // stops at the object budget before the records gate could engage.
  const sections49 = [];
  for (let i = 0; i < 49; i++) sections49.push(validSection(i));
  const over = withCustomSet(base, { documents: [nominalDoc(sections49)], assertions: [] }, "records-49");
  const refused = run(taskForSet(over.ref, 1), over.context);
  assert.equal(refused.status, "REFUSED");
  assert.equal(refused.diagnostics[0].code, "BUDGET_EXCEEDED");
});
