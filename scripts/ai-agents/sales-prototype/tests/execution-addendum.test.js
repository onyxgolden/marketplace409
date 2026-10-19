/**
 * execution-addendum.test.js — contract regression probes for the Sales
 * Agent: descriptor safety, grant-before-bytes, population completeness,
 * and budget-integrated admission, as runtime tests.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { run } from "../src/index.js";
import { SchemaError } from "../src/schemas.js";
import { loadStore, makeStandard, makeTask, makeContext, boundPopulation, PRODUCT_REGISTRY, makeProductRegistry } from "./helpers.js";

const store = loadStore();

test("addendum: denied-source grant checked before bytes are accessed", () => {
  const { task, context } = makeStandard(store);
  context.readGrants = []; // no grants at all
  const r = run(task, context);
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "ACTION_DENIED");
});

test("addendum: unsupported operation returns named refusal", () => {
  const { task, context } = makeStandard(store);
  task.operation = "dispatch_outreach";
  const r = run(task, context);
  assert.equal(r.status, "REFUSED");
  // validateTask rejects unknown operations structurally
  assert.equal(r.diagnostics[0].code, "INVALID_INPUT");
});

test("addendum: unknown principal role is denied", () => {
  const { task, context } = makeStandard(store);
  context.principal.role = "SUPERUSER";
  const r = run(task, context);
  assert.equal(r.status, "REFUSED");
});

test("addendum: complete population declaration binds identities", () => {
  const { task, context } = makeStandard(store);
  const t2 = makeTask(store, {
    population: {
      declared_complete: true, dataset_id: "sales-fixtures", dataset_version: "2026-10-19",
      expected_lead_ids: ["lead-high-01"], // wrong: not the full set
      expected_count: 16,
    },
  });
  const r = run(t2, context);
  assert.equal(r.report.population.complete, false);
  assert.ok(r.diagnostics.some((d) => d.code === "POPULATION_INCOMPLETE"));
});

test("addendum: unrelated dataset identity is not complete", () => {
  // Declared-complete against the wrong identity set must fail.
  // (Uses 4 IDs: the object budget is tight with the fix-round-3
  // evidence admission charges; the identity-binding property does not
  // need 16.)
  const { task, context } = makeStandard(store);
  const t2 = makeTask(store, {
    population: {
      declared_complete: true, dataset_id: "sales-fixtures", dataset_version: "2026-10-19",
      expected_lead_ids: Array.from({ length: 4 }, (_, i) => `other-${i}`),
      expected_count: 4,
    },
  });
  const r = run(t2, context);
  assert.equal(r.report.population.complete, false);
});

test("addendum: unbound dataset identity is not complete even with matching ids", () => {
  // S653-001: the caller's ids match, but the dataset identity does not
  // bind to the host registration -> no trusted coverage.
  // (Trims to 4 IDs: the object budget is tight with fix-round-3 evidence
  // charges; the identity-binding property does not need 16.)
  const { task, context } = makeStandard(store);
  const pop = boundPopulation(store, "main");
  pop.expected_lead_ids = pop.expected_lead_ids.slice(0, 4);
  pop.expected_count = 4;
  const t2 = makeTask(store, {
    population: { ...pop, dataset_id: "unrelated", dataset_version: "never-registered" },
  });
  const r = run(t2, context);
  assert.equal(r.report.population.complete, false);
  assert.equal(r.report.summary, null);
  assert.ok(r.diagnostics.some((d) => d.code === "POPULATION_INCOMPLETE"));
});

test("addendum: absent host expected_records means unknown coverage", () => {
  // Host registration without expected_records: coverage unknown, never
  // verified complete, even with a bound identity and matching ids.
  // (Trims to 4 IDs: the object budget is tight with fix-round-3 evidence
  // charges.)
  const s2 = JSON.parse(JSON.stringify(store));
  const key = "sales-fixtures|leads/main.json";
  const ref = s2.bundleRefs["main"];
  const rev = s2.sources[key].revisions[ref.commit];
  delete rev.expected_records;
  const { task, context } = makeStandard(s2);
  const pop = boundPopulation(s2, "main");
  pop.expected_lead_ids = pop.expected_lead_ids.slice(0, 4);
  pop.expected_count = 4;
  const t2 = makeTask(s2, { population: pop });
  const r = run(t2, context);
  assert.equal(r.report.population.complete, false);
  assert.equal(r.report.summary, null);
});

test("addendum: proxy task refuses with ZERO trap invocations", () => {
  const { context } = makeStandard(store);
  let touched = false;
  const task = new Proxy({ schema_version: "1" }, {
    get(t, k) { touched = true; return t[k]; },
    getOwnPropertyDescriptor(t, k) { touched = true; return Object.getOwnPropertyDescriptor(t, k); },
    getPrototypeOf(t) { touched = true; return Object.getPrototypeOf(t); },
    ownKeys(t) { touched = true; return Object.getOwnPropertyNames(t); },
  });
  const r = run(task, context);
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "INVALID_INPUT");
  assert.equal(touched, false, "no proxy trap may fire before refusal");
});

test("addendum: denied source metadata stays untouched (label accessor sentinel)", () => {
  // Deep-copy the store: the accessor sentinel must not leak into other tests.
  const s2 = JSON.parse(JSON.stringify(store));
  const { task, context } = makeStandard(s2);
  let touched = false;
  const key = Object.keys(context.sources)[0];
  const commit = Object.keys(context.sources[key].revisions)[0];
  Object.defineProperty(context.sources[key].revisions[commit], "label", {
    get() { touched = true; return "x"; }, enumerable: true, configurable: true,
  });
  context.readGrants = []; // no grants: the grant check must come first
  const r = run(task, context);
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "ACTION_DENIED");
  assert.equal(touched, false, "denied source metadata must remain untouched");
});

test("addendum: expired principal is denied before source admission", () => {
  const { task, context } = makeStandard(store);
  context.principal = { ...context.principal, valid_from: "2019-01-01", expires_at: "2020-06-01" };
  const r = run(task, context);
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "ACTION_DENIED");
  assert.equal(r.report, null);
});

test("addendum: future principal window is denied", () => {
  const { task, context } = makeStandard(store);
  context.principal = { ...context.principal, valid_from: "2027-01-01", expires_at: "2028-01-01" };
  const r = run(task, context);
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "ACTION_DENIED");
});

test("addendum: each classification carries a byte-exact citation", () => {
  const { task, context } = makeStandard(store);
  const r = run(task, context);
  assert.ok(r.report.classifications.length > 0);
  for (const c of r.report.classifications) {
    const cit = c.citation;
    assert.ok(cit, "classification must carry a citation");
    assert.equal(cit.source_ref.algorithm, "git-sha1");
    assert.ok(/^[0-9a-f]{40}$/.test(cit.source_ref.blob));
    assert.ok(Number.isInteger(cit.span.start_byte) && Number.isInteger(cit.span.end_byte));
    assert.ok(cit.span.end_byte > cit.span.start_byte);
    assert.equal(typeof cit.span.quoted_text, "string");
    assert.equal(cit.verification.round_trip_ok, true);
  }
});

test("addendum: drafts cite the lead span and carry structured product evidence", () => {
  const { task, context } = makeStandard(store);
  const r = run(task, context);
  assert.ok(r.report.drafts.length > 0);
  for (const d of r.report.drafts) {
    assert.ok(d.citation && d.citation.span, "draft must carry a citation");
    assert.equal(typeof d.citation.quoted_span, "string");
    // S653-002 (fix round 3): product evidence is a PINNED record —
    // VERIFIED state with the versioned evidence_ref tuple, not a bare
    // label. The pin must resolve to the registered catalog.
    const pe = d.citation.product_evidence;
    assert.equal(pe.state, "VERIFIED");
    assert.ok(pe.product_id && pe.product_token);
    assert.ok(pe.evidence_ref, "VERIFIED evidence must carry the evidence_ref pin");
    assert.equal(pe.evidence_ref.repo, "sales-fixtures");
    assert.equal(pe.evidence_ref.path, "products/catalog.json");
    assert.ok(/^[0-9a-f]{40}$/.test(pe.evidence_ref.commit));
    assert.ok(/^[0-9a-f]{40}$/.test(pe.evidence_ref.blob));
    assert.equal(pe.evidence_ref.algorithm, "git-sha1");
  }
});

test("addendum: draft withheld when product evidence is unavailable", () => {
  // S653-002 (fix round 2): conservative eligibility — a verified product
  // WITHOUT registered evidence yields no draft.
  const s = makeStandard(store);
  const reg = makeProductRegistry(store);
  delete reg["crm-starter"].evidence;
  s.context.product_registry = reg;
  const r = run(s.task, s.context);
  assert.ok(r.report.drafts.length === 0, "no drafts without product evidence");
  assert.ok(r.diagnostics.some((d) => d.code === "NO_DRAFT" && d.reason.includes("UNAVAILABLE_PRODUCT_EVIDENCE")));
});

test("addendum: structurally corrupt lead bundle refuses with no partial payload", () => {
  const { task, context } = makeStandard(store, { bundleNames: ["duplicates"] }, { bundleNames: ["duplicates"] });
  const r = run(task, context);
  assert.equal(r.status, "REFUSED");
  assert.equal(r.report, null);
  assert.equal(r.complete, false);
  assert.deepEqual(r.routing_flags, []);
});

test("addendum: output envelope carries the fixed public fields", () => {
  const { task, context } = makeStandard(store);
  const r = run(task, context);
  assert.equal(r.schema_version, "1");
  assert.equal(r.agent, "sales-agent");
  assert.equal(r.advisory, true);
  assert.equal(r.fixture_only, true);
  assert.equal(r.authorization_granted, false);
  assert.ok(Array.isArray(r.source_refs));
  assert.ok(r.source_refs.length > 0);
  for (const s of r.source_refs) {
    assert.equal(s.algorithm, "git-sha1");
    assert.ok(/^[0-9a-f]{40}$/.test(s.commit));
    assert.ok(/^[0-9a-f]{40}$/.test(s.blob));
  }
});

test("addendum: changed report interval with unchanged registration is not complete (S653-001)", () => {
  // The reviewer's exact probe: host coverage binds 2026-10-01..2026-10-31.
  // A caller-selected 2020 interval cannot supply its own coverage.
  const s = makeStandard(store, { bundleNames: ["empty"] }, { bundleNames: ["empty"] });
  const pop = boundPopulation(store, "empty");
  const t2 = makeTask(store, {
    bundleNames: ["empty"],
    population: pop,
    options: { report_interval_start: "2020-01-01", report_interval_end: "2020-12-31" },
  });
  const r = run(t2, s.context);
  assert.equal(r.report.population.complete, false);
  assert.equal(r.report.summary, null);
  assert.ok(r.diagnostics.some((d) => d.code === "POPULATION_INCOMPLETE"));
});

test("addendum: covered interval is complete (S653-001 positive)", () => {
  const s = makeStandard(store, { bundleNames: ["empty"] }, { bundleNames: ["empty"] });
  const pop = boundPopulation(store, "empty");
  const t2 = makeTask(store, { bundleNames: ["empty"], population: pop });
  const r = run(t2, s.context);
  assert.equal(r.report.population.complete, true);
  assert.equal(r.status, "REPORT_READY");
});

test("addendum: unknown coverage (no host contract) is not complete (S653-001)", () => {
  const s2 = JSON.parse(JSON.stringify(store));
  const key = "sales-fixtures|leads/empty.json";
  const ref = s2.bundleRefs["empty"];
  delete s2.sources[key].revisions[ref.commit].coverage;
  const { task, context } = makeStandard(s2, { bundleNames: ["empty"] }, { bundleNames: ["empty"] });
  const pop = boundPopulation(s2, "empty");
  const t2 = makeTask(s2, { bundleNames: ["empty"], population: pop });
  const r = run(t2, context);
  assert.equal(r.report.population.complete, false);
  assert.equal(r.report.summary, null);
});

test("addendum: exact coverage endpoints are applicable (S653-001 boundaries)", () => {
  const s = makeStandard(store, { bundleNames: ["empty"] }, { bundleNames: ["empty"] });
  const pop = boundPopulation(store, "empty");
  // Exactly the registered coverage interval -> applicable.
  const t2 = makeTask(store, {
    bundleNames: ["empty"],
    population: pop,
    options: { report_interval_start: "2026-10-01", report_interval_end: "2026-10-31" },
  });
  assert.equal(run(t2, s.context).report.population.complete, true);
  // One day beyond the coverage end -> not applicable.
  const t3 = makeTask(store, {
    bundleNames: ["empty"],
    population: pop,
    options: { report_interval_start: "2026-10-01", report_interval_end: "2026-11-01" },
  });
  const r3 = run(t3, s.context);
  assert.equal(r3.report.population.complete, false);
  assert.equal(r3.report.summary, null);
});

test("addendum: host/task/bytes blob disagreement fails closed (S653-002)", () => {
  // The reviewer's exact probe: change ONLY the host-registered rev.blob
  // to another valid 40-hex value, keeping bytes and the task pin.
  const s2 = JSON.parse(JSON.stringify(store));
  const key = "sales-fixtures|leads/main.json";
  const ref = s2.bundleRefs["main"];
  s2.sources[key].revisions[ref.commit].blob = "1".repeat(40);
  const { task, context } = makeStandard(s2);
  const r = run(task, context);
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "HASH_MISMATCH");
  assert.equal(r.report, null);
});

test("addendum: task pin disagreement with registered bytes fails closed (S653-002)", () => {
  const { task, context } = makeStandard(store);
  const t2 = makeTask(store, { sourceRefOverrides: { main: { blob: "2".repeat(40) } } });
  const r = run(t2, context);
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "HASH_MISMATCH");
  assert.equal(r.report, null);
});

test("addendum: citations slice independently from source bytes (S653-002)", () => {
  // Every classification citation is verified by re-slicing the quoted
  // span from the bundle bytes — no trust in the candidate's offsets.
  const { task, context } = makeStandard(store);
  const r = run(task, context);
  assert.ok(r.report.classifications.length > 0);
  const key = "sales-fixtures|leads/main.json";
  const ref = store.bundleRefs["main"];
  const bytes = Buffer.from(store.sources[key].revisions[ref.commit].text, "utf8");
  for (const c of r.report.classifications) {
    const cit = c.citation;
    assert.equal(typeof cit.quoted_span, "string", "agreed schema carries quoted_span");
    const slice = bytes.subarray(cit.span.start_byte, cit.span.end_byte);
    assert.equal(slice.toString("utf8"), cit.quoted_span, "quoted_span must equal the exact byte slice");
    assert.ok(Buffer.from(cit.quoted_span, "utf8").equals(slice), "slice must round-trip byte-exactly");
    assert.ok(cit.quoted_span.includes(`"lead_id":"${c.lead_id}"`) || cit.quoted_span.includes(`"lead_id": "${c.lead_id}"`) || cit.quoted_span.includes(c.lead_id));
  }
});

test("addendum: metrics carry calculation-basis records (S653-002)", () => {
  const { task, context } = makeStandard(store);
  const r = run(task, context);
  assert.ok(r.report.metrics.length > 0);
  const leadIds = new Set(r.report.classifications.map((c) => c.lead_id));
  for (const m of r.report.metrics) {
    const basis = m.calculation_basis;
    assert.ok(basis, "metrics group must carry a calculation_basis");
    assert.equal(basis.criteria_ref.criteria_version, "2026-10-19");
    assert.equal(basis.criteria_evidence.state, "HOST_REGISTERED");
    assert.ok(basis.contributing_leads.length > 0);
    // Every contributing lead_id resolves to a classification carrying a
    // byte-exact citation in this same envelope.
    for (const cl of basis.contributing_leads) {
      assert.ok(leadIds.has(cl.lead_id), `contributing lead ${cl.lead_id} must resolve to a classification`);
      const cls = r.report.classifications.find((c) => c.lead_id === cl.lead_id);
      assert.ok(cls.citation && cls.citation.span, "linked classification must carry a citation");
    }
    // No lead outside the group may contribute to it.
    for (const cl of basis.contributing_leads) {
      const cls = r.report.classifications.find((c) => c.lead_id === cl.lead_id);
      assert.equal(cls.currency, m.currency);
    }
  }
});

test("addendum: classifications carry criteria evidence (S653-002)", () => {
  const { task, context } = makeStandard(store);
  const r = run(task, context);
  for (const c of r.report.classifications) {
    assert.ok(c.criteria_evidence, "classification must carry criteria evidence");
    assert.equal(c.criteria_evidence.criteria_version, "2026-10-19");
    // S653-002 (fix round 3): criteria are pinned by host-registered
    // id+version, not prose.
    assert.equal(c.criteria_evidence.state, "HOST_REGISTERED");
    assert.equal(c.criteria_evidence.criteria_id, "sales-v1");
  }
});

test("addendum: blank VERIFIED evidence label without a pin is a structural refusal (S653-002)", () => {
  // The reviewer's exact probe: a bare {state:"VERIFIED",detail:""} label
  // must NOT promote drafts to VERIFIED. Without an evidence_ref pin it
  // is malformed input.
  const s = makeStandard(store);
  const reg = makeProductRegistry(store);
  reg["crm-starter"].evidence = { state: "VERIFIED", detail: "" };
  s.context.product_registry = reg;
  const r = run(s.task, s.context);
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "INVALID_INPUT");
  assert.equal(r.report, null);
});

test("addendum: fabricated evidence pin to an unregistered source withholds drafts (S653-002)", () => {
  // A well-formed pin naming a source the host never registered is
  // conservative: no drafts, never VERIFIED.
  const s = makeStandard(store);
  const reg = makeProductRegistry(store);
  reg["crm-starter"].evidence = {
    state: "VERIFIED",
    detail: "fabricated",
    evidence_ref: {
      repo: "sales-fixtures", path: "products/catalog.json",
      commit: "f".repeat(40), blob: "e".repeat(40),
      algorithm: "git-sha1", revision: "sales-fixtures/products@v999",
    },
  };
  s.context.product_registry = reg;
  const r = run(s.task, s.context);
  assert.ok(r.report.drafts.length === 0, "no drafts on fabricated evidence pin");
  assert.ok(r.diagnostics.some((d) => d.code === "PRODUCT_EVIDENCE_UNRESOLVED"));
});

test("addendum: stale evidence pin (blob mismatch) withholds drafts (S653-002)", () => {
  // The pin names the registered source but a wrong blob: the bytes do
  // not match the registration -> conservative, no drafts.
  const s = makeStandard(store);
  const reg = makeProductRegistry(store);
  const pin = { ...store.evidenceCatalogRef, blob: "d".repeat(40) };
  reg["crm-starter"].evidence = { state: "VERIFIED", detail: "stale", evidence_ref: pin };
  s.context.product_registry = reg;
  const r = run(s.task, s.context);
  assert.ok(r.report.drafts.length === 0, "no drafts on stale evidence pin");
  assert.ok(r.diagnostics.some((d) => d.code === "PRODUCT_EVIDENCE_UNRESOLVED"));
});

test("addendum: wrong-product evidence pin withholds drafts (S653-002)", () => {
  // The pin resolves to registered bytes, but the catalog does not
  // document THIS product -> conservative, no drafts. Uses a product_id
  // ("forecast-plus") that is an allowlisted token but absent from the
  // evidence catalog, with a FIT_HIGH lead pointed at it so draft
  // eligibility is actually attempted.
  const s2 = JSON.parse(JSON.stringify(store));
  const key = "sales-fixtures|leads/main.json";
  const ref = s2.bundleRefs["main"];
  const leads = JSON.parse(s2.sources[key].revisions[ref.commit].text);
  const target = leads.find((l) => l.need_match && l.budget_match && (l.timing_days ?? 999) <= 90 && !l.do_not_contact);
  assert.ok(target, "fixture must contain a FIT_HIGH lead");
  target.fixture_product_id = "forecast-plus";
  const text = JSON.stringify(leads);
  const header = Buffer.from(`blob ${Buffer.byteLength(text, "utf8")}\0`, "utf8");
  const blob = createHash("sha1").update(Buffer.concat([header, Buffer.from(text, "utf8")])).digest("hex");
  s2.sources[key].revisions[ref.commit] = {
    ...s2.sources[key].revisions[ref.commit], text, blob,
  };
  const { task, context } = makeStandard(s2);
  const reg = makeProductRegistry(s2);
  reg["forecast-plus"] = {
    product_id: "forecast-plus",
    product_token: "forecast-plus",
    benefit_tokens: ["accurate-forecast"],
    verified: true,
    evidence: {
      state: "VERIFIED",
      detail: "pin resolves, but the catalog has no forecast-plus entry",
      evidence_ref: { ...s2.evidenceCatalogRef },
    },
  };
  context.product_registry = reg;
  // The task pin must match the modified bytes.
  task.fixture_refs[0].blob = blob;
  const r = run(task, context);
  assert.ok(r.diagnostics.some((d) => d.code === "PRODUCT_EVIDENCE_UNRESOLVED" && d.reason.includes("forecast-plus")));
  for (const d of r.report.drafts) {
    assert.notEqual(d.citation.product_evidence.product_id, "forecast-plus", "no VERIFIED draft on wrong-product evidence");
  }
});

test("addendum: positive registered evidence produces pinned drafts (S653-002)", () => {
  // The actual positive: a pin that resolves to registered bytes
  // documenting the product -> drafts built, evidence_ref emitted.
  const { task, context } = makeStandard(store);
  const r = run(task, context);
  assert.ok(r.report.drafts.length > 0, "positive registered evidence must produce drafts");
  assert.ok(!r.diagnostics.some((d) => d.code === "PRODUCT_EVIDENCE_UNRESOLVED"));
  for (const d of r.report.drafts) {
    assert.equal(d.citation.product_evidence.state, "VERIFIED");
    assert.ok(d.citation.product_evidence.evidence_ref, "draft must carry the evidence pin");
  }
});
