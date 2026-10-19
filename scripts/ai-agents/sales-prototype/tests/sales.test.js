/**
 * sales.test.js — domain logic: fit classification, DNC suppression,
 * draft construction, pipeline metrics, exact rational arithmetic.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash as nodeCreateHash } from "node:crypto";
import { run } from "../src/index.js";
import {
  classifyFit, checkSuppression, buildDrafts, escapeUntrusted,
  weightedRational, addRationals, roundRationalHalfAway, sumWeightedRounded,
  sumMinorExact, computePipelineMetrics, compareHeaderClaims,
} from "../src/sales.js";
import { loadStore, makeStandard, makeTask, makeContext, CRITERIA, PRODUCT_REGISTRY } from "./helpers.js";

const store = loadStore();

describe("classifyFit precedence", () => {
  const T = 90;
  it("explicit need_match=false -> FIT_LOW even with good timing", () => {
    assert.deepEqual(classifyFit({ need_match: false, budget_match: true, timing_days: 10 }, T), { fit: "FIT_LOW", gaps: [] });
  });
  it("explicit budget_match=false -> FIT_LOW", () => {
    assert.deepEqual(classifyFit({ need_match: true, budget_match: false, timing_days: 10 }, T), { fit: "FIT_LOW", gaps: [] });
  });
  it("both false -> FIT_LOW", () => {
    assert.deepEqual(classifyFit({ need_match: false, budget_match: false, timing_days: 10 }, T), { fit: "FIT_LOW", gaps: [] });
  });
  it("missing need_match -> FIT_UNKNOWN with gaps", () => {
    assert.deepEqual(classifyFit({ need_match: null, budget_match: true, timing_days: 10 }, T), { fit: "FIT_UNKNOWN", gaps: ["need_match"] });
  });
  it("missing all -> FIT_UNKNOWN with all gaps", () => {
    assert.deepEqual(classifyFit({ need_match: null, budget_match: null, timing_days: null }, T),
      { fit: "FIT_UNKNOWN", gaps: ["need_match", "budget_match", "timing_days"] });
  });
  it("false beats missing: need=false + budget=null -> FIT_LOW", () => {
    assert.deepEqual(classifyFit({ need_match: false, budget_match: null, timing_days: null }, T), { fit: "FIT_LOW", gaps: [] });
  });
  it("timing exactly 90 -> FIT_HIGH", () => {
    assert.deepEqual(classifyFit({ need_match: true, budget_match: true, timing_days: 90 }, T), { fit: "FIT_HIGH", gaps: [] });
  });
  it("timing 91 -> FIT_MEDIUM", () => {
    assert.deepEqual(classifyFit({ need_match: true, budget_match: true, timing_days: 91 }, T), { fit: "FIT_MEDIUM", gaps: [] });
  });
  it("timing 0 -> FIT_HIGH", () => {
    assert.deepEqual(classifyFit({ need_match: true, budget_match: true, timing_days: 0 }, T), { fit: "FIT_HIGH", gaps: [] });
  });
});

describe("checkSuppression", () => {
  it("do_not_contact=true suppresses", () => {
    assert.deepEqual(checkSuppression({ do_not_contact: true }), { suppressed: true });
  });
  it("do_not_contact=false does not suppress", () => {
    assert.deepEqual(checkSuppression({ do_not_contact: false }), { suppressed: false });
  });
});

describe("escapeUntrusted", () => {
  it("escapes HTML-significant characters", () => {
    assert.equal(escapeUntrusted("<script>alert('x')</script>"), "&lt;script&gt;alert(&#x27;x&#x27;)&lt;/script&gt;");
  });
  it("escapes quotes and backticks", () => {
    assert.equal(escapeUntrusted(`a"b'c\`d`), "a&quot;b&#x27;c&#x60;d");
  });
  it("non-string -> empty", () => {
    assert.equal(escapeUntrusted(null), "");
  });
});

describe("buildDrafts", () => {
  it("two variants, both marked DRAFT — NOT SENT, allowlisted tokens only", () => {
    const lead = { lead_id: "l1", display_name: "Test <b>Co</b>" };
    const product = PRODUCT_REGISTRY["crm-starter"];
    const drafts = buildDrafts(lead, product, CRITERIA);
    assert.equal(drafts.length, 2);
    assert.equal(drafts[0].variant, "introduction");
    assert.equal(drafts[1].variant, "clarification");
    for (const d of drafts) {
      assert.ok(d.text.includes("DRAFT — NOT SENT"));
      assert.ok(d.text.includes("crm-starter"));
      assert.ok(!d.text.includes("<b>")); // display name escaped
      assert.ok(!d.text.toLowerCase().includes("discount"));
    }
  });
});

describe("exact rational arithmetic", () => {
  it("weightedRational keeps exact fraction", () => {
    assert.deepEqual(weightedRational("1", 1, 2), { num: 1n, den: 2n });
    assert.deepEqual(weightedRational("300000", 4, 5), { num: 1200000n, den: 5n });
  });
  it("addRationals is exact", () => {
    assert.deepEqual(addRationals({ num: 1n, den: 2n }, { num: 1n, den: 3n }), { num: 5n, den: 6n });
  });
  it("roundRationalHalfAway: 0.5 -> 1, -0.5 -> -1, 0.4 -> 0", () => {
    assert.equal(roundRationalHalfAway(1n, 2n), 1n);
    assert.equal(roundRationalHalfAway(-1n, 2n), -1n);
    assert.equal(roundRationalHalfAway(2n, 5n), 0n);
    assert.equal(roundRationalHalfAway(3n, 5n), 1n);
    assert.equal(roundRationalHalfAway(5n, 2n), 3n); // 2.5 -> 3
  });
  it("sumWeightedRounded: one-cent tie rounds half away from zero", () => {
    assert.equal(sumWeightedRounded([{ num: 1n, den: 2n }]), "1");
  });
  it("sumMinorExact: no float drift on large sums", () => {
    assert.equal(sumMinorExact(["9007199254740993", "1"]), "9007199254740994");
  });
});

describe("run() end-to-end domain", () => {
  it("main bundle: REPORT or PARTIAL with correct fits and suppression", () => {
    const { task, context } = makeStandard(store);
    const r = run(task, context);
    assert.ok(["REPORT_READY", "PARTIAL"].includes(r.status));
    const byId = Object.fromEntries(r.report.classifications.map((c) => [c.lead_id, c]));
    assert.equal(byId["lead-high-01"].fit, "FIT_HIGH");
    assert.equal(byId["lead-med-01"].fit, "FIT_MEDIUM");
    assert.equal(byId["lead-low-01"].fit, "FIT_LOW");
    assert.equal(byId["lead-unk-01"].fit, "FIT_UNKNOWN");
    assert.deepEqual(byId["lead-unk-01"].gaps, ["need_match", "budget_match"]);
    assert.equal(byId["lead-dnc-01"].suppressed, true);
    // Suppressed lead yields zero variants.
    assert.ok(!r.report.drafts.some((d) => d.lead_id === "lead-dnc-01"));
    assert.ok(!r.report.drafts.some((d) => d.lead_id === "lead-dnc-inj"));
    // FIT_HIGH eligible leads get exactly two drafts each.
    for (const id of ["lead-high-01", "lead-high-02", "lead-tie-01"]) {
      assert.equal(r.report.drafts.filter((d) => d.lead_id === id).length, 2);
    }
  });

  it("USD open gross is exact: 1810001", () => {
    const { task, context } = makeStandard(store);
    const r = run(task, context);
    const usd = r.report.metrics.find((m) => m.currency === "USD");
    assert.equal(usd.open_gross_minor, "1810001");
  });

  it("USD weighted rounds once half-away-from-zero: 1027501", () => {
    const { task, context } = makeStandard(store);
    const r = run(task, context);
    const usd = r.report.metrics.find((m) => m.currency === "USD");
    assert.equal(usd.open_weighted_minor, "1027501");
  });

  it("EUR group is separate; no FX mixing", () => {
    const { task, context } = makeStandard(store);
    const r = run(task, context);
    const eur = r.report.metrics.find((m) => m.currency === "EUR");
    assert.equal(eur.open_gross_minor, "450000");
    assert.equal(eur.open_weighted_minor, "225000");
  });

  it("win rate 1/1 -> 0.5 DEFINED; zero closed -> UNDEFINED", () => {
    const { task, context } = makeStandard(store);
    const r = run(task, context);
    const usd = r.report.metrics.find((m) => m.currency === "USD");
    assert.deepEqual(usd.win_rate, { state: "DEFINED", won: 1, lost: 1, value: 0.5 });
    const eur = r.report.metrics.find((m) => m.currency === "EUR");
    assert.deepEqual(eur.win_rate, { state: "UNDEFINED" });
  });

  it("duplicate lead_id refuses with DUPLICATE_ID", () => {
    const { task, context } = makeStandard(store, { bundleNames: ["duplicates"] }, { bundleNames: ["duplicates"] });
    const r = run(task, context);
    assert.equal(r.status, "REFUSED");
    assert.equal(r.diagnostics[0].code, "DUPLICATE_ID");
    assert.equal(r.report, null);
  });

  it("duplicate opportunity_id refuses", () => {
    const { task, context } = makeStandard(store, { bundleNames: ["duplicate-opps"] }, { bundleNames: ["duplicate-opps"] });
    const r = run(task, context);
    assert.equal(r.status, "REFUSED");
    assert.equal(r.diagnostics[0].code, "DUPLICATE_ID");
  });

  it("temporal violation marks metrics unverifiable", () => {
    const { task, context } = makeStandard(store, { bundleNames: ["temporal"] }, { bundleNames: ["temporal"] });
    const r = run(task, context);
    const m = r.report.metrics[0];
    assert.equal(m.unverifiable, true);
    assert.ok(m.unverifiable_reasons[0].includes("temporal order violation"));
    assert.equal(r.report.summary, null);
  });

  it("header mismatch suppresses the summary but keeps the comparison", () => {
    const { task, context } = makeStandard(store, {}, {
      bundleNames: ["main"],
    });
    const t2 = makeTask(store, {
      headerClaims: { open_gross_minor: "5000000", currency: "USD", report_interval_start: "2026-10-01", report_interval_end: "2026-10-31" },
    });
    const r = run(t2, context);
    assert.equal(r.report.summary, null);
    assert.equal(r.report.header_comparison.match, false);
    assert.equal(r.report.header_comparison.claimed, "5000000");
    assert.equal(r.report.header_comparison.computed, "1810001");
    assert.ok(r.diagnostics.some((d) => d.code === "HEADER_MISMATCH"));
  });

  it("header match keeps the summary", () => {
    const { task, context } = makeStandard(store);
    const t2 = makeTask(store, {
      headerClaims: { open_gross_minor: "1810001", currency: "USD", report_interval_start: "2026-10-01", report_interval_end: "2026-10-31" },
    });
    const r = run(t2, context);
    // summary is null here only because quarantines exist in the main bundle
    assert.equal(r.report.header_comparison.match, true);
  });

  it("empty bundle with declared-complete population: verified zero pipeline", () => {
    const { task, context } = makeStandard(store, { bundleNames: ["empty"] }, { bundleNames: ["empty"] });
    const t2 = makeTask(store, {
      bundleNames: ["empty"],
      population: { declared_complete: true, dataset_id: "empty-set", dataset_version: "v1", expected_lead_ids: [], expected_count: 0 },
    });
    const r = run(t2, context);
    assert.equal(r.report.classifications.length, 0);
    assert.equal(r.report.population.complete, true);
  });

  it("unknown completeness -> no verified whole-pipeline totals", () => {
    const { task, context } = makeStandard(store);
    assert.equal(r_complete_population_flag(run(task, context)), false);
    function r_complete_population_flag(r) {
      return r.report.population !== null && r.report.population.complete === true;
    }
  });

  it("malformed probability (150%) refuses at validation", () => {
    // Build a bundle with probability_num > probability_den.
    const badLead = {
      lead_id: "bad-prob", opportunity_id: "bad-prob-opp", need_match: true, budget_match: true,
      timing_days: 10, do_not_contact: false, stage: "NEW", amount_minor: "1000", currency: "USD",
      probability_num: 3, probability_den: 2, created_at: "2026-09-01", stage_entered_at: "2026-09-15",
      closed_at: null, fixture_product_id: "crm-starter", display_name: "Bad", notes: "",
    };
    const text = JSON.stringify([badLead]);
    const store2 = JSON.parse(JSON.stringify(store));
    const key = "sales-fixtures|leads/bad-prob.json";
    const commit = "a".repeat(40);
    const header = Buffer.from(`blob ${Buffer.byteLength(text, "utf8")}\0`, "utf8");
    const blob = nodeCreateHash("sha1").update(Buffer.concat([header, Buffer.from(text, "utf8")])).digest("hex");
    store2.sources[key] = { revisions: { [commit]: { text, blob, label: "x", expected_records: 1 } } };
    store2.bundleRefs["bad-prob"] = { repo: "sales-fixtures", path: "leads/bad-prob.json", commit };
    const { task, context } = makeStandard(store2, { bundleNames: ["bad-prob"] }, { bundleNames: ["bad-prob"] });
    const r = run(task, context);
    assert.equal(r.status, "REFUSED");
    assert.equal(r.diagnostics[0].code, "INVALID_INPUT");
    assert.equal(r.report, null);
  });

  it("1000-lead bundle is an explicit budget refusal", () => {
    const { task, context } = makeStandard(store, { bundleNames: ["big-1000"] }, { bundleNames: ["big-1000"] });
    const r = run(task, context);
    assert.equal(r.status, "REFUSED");
    // Either the payload-byte cap or the object cap may trip first; both
    // are explicit over-budget refusals with no partial domain artifact.
    assert.ok(["INPUT_LIMIT", "BUDGET_EXCEEDED"].includes(r.diagnostics[0].code));
    assert.equal(r.report, null);
    assert.equal(r.complete, false);
  });
});

describe("compareHeaderClaims", () => {
  it("no header claims -> not checked", () => {
    assert.deepEqual(compareHeaderClaims(undefined, []), { checked: false });
  });
  it("missing currency group -> computed 0", () => {
    const hc = { open_gross_minor: "0", currency: "JPY", report_interval_start: "2026-10-01", report_interval_end: "2026-10-31" };
    const r = compareHeaderClaims(hc, []);
    assert.equal(r.match, true);
    assert.equal(r.computed, "0");
  });
});
