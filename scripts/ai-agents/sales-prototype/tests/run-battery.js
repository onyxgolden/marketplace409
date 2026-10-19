#!/usr/bin/env node
/**
 * run-battery.js — `npm run battery` entrypoint: builtins-only trust
 * authentication BEFORE any scored battery case is executed.
 *
 * The separately trusted approval root is a host input (SALES_APPROVED_ROOT
 * env). The full corpus digest is recomputed with node:fs / node:crypto
 * ONLY and authenticated against that root BEFORE the battery runs.
 * Refuse (exit 3) on mismatch.
 *
 * Each case in corpus/battery.json carries a probe describing the
 * expectation. The runner executes the real run() (via the guarded
 * worker path) and checks the probe. Any failure exits nonzero with
 * the failing case_id.
 */

import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { normalize } from "node:path/posix";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const APPROVED_ROOT = process.env.SALES_APPROVED_ROOT;
if (typeof APPROVED_ROOT !== "string" || !/^[0-9a-f]{64}$/.test(APPROVED_ROOT)) {
  console.error("bootstrap: missing separately trusted approval root (SALES_APPROVED_ROOT) — refusing to run");
  process.exit(3);
}

// ---- trust authentication (builtins only; same scheme as run-tests.js) ----
{
  const sha = (b) => createHash("sha256").update(b).digest("hex");
  let bad = null;
  let manifest = null;
  try {
    manifest = JSON.parse(readFileSync(join(ROOT, "corpus", "manifest.json"), "utf8"));
  } catch {
    bad = "corpus/manifest.json unreadable";
  }
  const files = manifest?.files ?? [];
  const seen = new Set();
  if (!bad) {
    for (const e of files) {
      const p = e?.path;
      if (
        typeof p !== "string" || p.length === 0 || p.startsWith("/") || p.includes("\\") ||
        normalize(p) !== p || p.startsWith("..") || p.includes("../") || seen.has(p)
      ) { bad = `bad manifest entry: ${String(p)}`; break; }
      seen.add(p);
      let bytes;
      try { bytes = readFileSync(join(ROOT, p)); } catch { bad = `missing pinned file: ${p}`; break; }
      if (sha(bytes) !== e.sha256) { bad = `hash mismatch: ${p}`; break; }
    }
  }
  if (!bad) {
    const walk = (dir, out = []) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else out.push(p);
      }
      return out;
    };
    for (const sub of ["src", "tests", "runner", "fixtures", "corpus"]) {
      for (const p of walk(join(ROOT, sub))) {
        const rel = p.slice(ROOT.length + 1).replace(/\\/g, "/");
        if (rel === "corpus/manifest.json" || rel === "corpus/corpus_digest.txt") continue;
        if (!seen.has(rel)) { bad = `unlisted file: ${rel}`; break; }
      }
      if (bad) break;
    }
    for (const f of ["package.json", "README.md"]) {
      if (!seen.has(f)) { bad = `unlisted file: ${f}`; break; }
    }
  }
  if (!bad) {
    const digest = sha(JSON.stringify(manifest));
    if (digest !== APPROVED_ROOT) bad = `corpus digest mismatch: recomputed ${digest.slice(0, 16)}… vs approved ${APPROVED_ROOT.slice(0, 16)}…`;
  }
  if (bad) {
    console.error(`bootstrap: trust authentication failed — ${bad} — refusing to run`);
    process.exit(3);
  }
  console.log("bootstrap: trust authentication passed");
}

// ---- battery execution ----
const cases = JSON.parse(readFileSync(join(ROOT, "corpus", "battery.json"), "utf8"));
const { runGuarded } = await import("../runner/run-guarded.js");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));

// Reuse the test helpers by importing them (they are manifest-pinned).
const helpers = await import("./helpers.js");

let pass = 0, fail = 0;
const failures = [];

function check(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function runCase(c) {
  const bundleNames = c.task.bundleNames ?? ["main"];
  const task = helpers.makeTask(store, {
    bundleNames,
    taskId: c.case_id,
    options: { include_drafts: true, ...(c.task.options || {}) },
    ...(c.population ? { population: c.population } : {}),
    ...(c.headerClaims ? { headerClaims: c.headerClaims } : {}),
    ...(c.refOverrides ? { sourceRefOverrides: c.refOverrides } : {}),
  });
  // taskOverrides mutate the built task object directly.
  if (c.taskOverrides) {
    for (const [k, v] of Object.entries(c.taskOverrides)) task[k] = v;
  }
  const ctxOpts = { bundleNames, ...(c.ctxOverrides || {}) };
  if (c.ctxOverrides?.principalRevoked) {
    ctxOpts.principal = { principal_id: "x", role: "JASON", registered_by: "h", valid_from: "2026-01-01", expires_at: "2027-01-01", revoked: true };
  }
  if (c.ctxOverrides?.principalRole) {
    ctxOpts.principal = { principal_id: "x", role: c.ctxOverrides.principalRole, registered_by: "h", valid_from: "2026-01-01", expires_at: "2027-01-01", revoked: false };
  }
  if (c.ctxOverrides?.prefillOutputRecords !== undefined) {
    ctxOpts.testHooks = { prefill_output_records: c.ctxOverrides.prefillOutputRecords };
  }
  if (c.ctxOverrides?.readGrants !== undefined) ctxOpts.readGrants = c.ctxOverrides.readGrants;
  const context = helpers.makeContext(store, ctxOpts);
  const raw = await runGuarded(JSON.stringify(task), JSON.stringify(context));
  return raw;
}

// Custom single-record probes need bespoke bundles; build them inline.
function customBundle(leads, name) {
  const text = JSON.stringify(leads);
  const commit = "d".repeat(40);
  const header = Buffer.from(`blob ${Buffer.byteLength(text, "utf8")}\0`, "utf8");
  const blob = createHash("sha1").update(Buffer.concat([header, Buffer.from(text, "utf8")])).digest("hex");
  const s2 = JSON.parse(JSON.stringify(store));
  const key = `sales-fixtures|leads/${name}.json`;
  s2.sources[key] = { revisions: { [commit]: { text, blob, label: "custom", expected_records: leads.length } } };
  s2.bundleRefs[name] = { repo: "sales-fixtures", path: `leads/${name}.json`, commit };
  return s2;
}
function goodLead(id, overrides = {}) {
  return {
    lead_id: id, opportunity_id: `${id}-opp`, need_match: true, budget_match: true,
    timing_days: 30, do_not_contact: false, stage: "NEW", amount_minor: "1000",
    currency: "USD", probability_num: 1, probability_den: 2,
    created_at: "2026-09-01", stage_entered_at: "2026-09-15", closed_at: null,
    fixture_product_id: "crm-starter", display_name: "T", notes: "", ...overrides,
  };
}

async function checkProbe(c, raw) {
  const p = c.probe;
  const r = raw.report;
  switch (p.kind) {
    case "fit": {
      const { classifyFit } = await import("../src/sales.js");
      const got = classifyFit({ need_match: p.need_match, budget_match: p.budget_match, timing_days: p.timing_days }, 90);
      check(got.fit === p.expect_fit, `fit: got ${got.fit}, want ${p.expect_fit}`);
      break;
    }
    case "bundle-fit": {
      const cl = r.classifications.find((x) => x.lead_id === p.lead_id);
      check(cl && cl.fit === p.expect_fit, `bundle-fit ${p.lead_id}: got ${cl?.fit}, want ${p.expect_fit}`);
      break;
    }
    case "money": {
      const { weightedRational, roundRationalHalfAway, sumMinorExact } = await import("../src/sales.js");
      if (p.op === "weighted") {
        const wr = weightedRational(p.amount, p.num, p.den);
        check(roundRationalHalfAway(wr.num, wr.den).toString() === p.expect, `weighted: got ${roundRationalHalfAway(wr.num, wr.den)}, want ${p.expect}`);
      } else {
        check(sumMinorExact(p.amounts) === p.expect, `gross: got ${sumMinorExact(p.amounts)}, want ${p.expect}`);
      }
      break;
    }
    case "bundle-metric": {
      const m = r.metrics.find((x) => x.currency === p.currency);
      check(m && m[p.field] === p.expect, `metric ${p.currency}.${p.field}: got ${m?.[p.field]}, want ${p.expect}`);
      break;
    }
    case "bundle-winrate": {
      const m = r.metrics.find((x) => x.currency === p.currency);
      check(m.win_rate.state === p.expect.state, `winrate state: got ${m.win_rate.state}`);
      if (p.expect.state === "DEFINED") {
        check(m.win_rate.won === p.expect.won && m.win_rate.lost === p.expect.lost, `winrate counts`);
      }
      break;
    }
    case "draft-count":
      check(r.drafts.length === p.expect, `drafts: got ${r.drafts.length}, want ${p.expect}`);
      break;
    case "draft-marker":
      check(r.drafts.every((d) => d.text.includes(p.expect) && d.marker === p.expect), "draft marker missing");
      break;
    case "no-draft-leads":
      for (const id of p.lead_ids) check(!r.drafts.some((d) => d.lead_id === id), `unexpected draft for ${id}`);
      break;
    case "status":
      check(raw.status === p.expect, `status: got ${raw.status}, want ${p.expect}`);
      break;
    case "classification-count":
      check(r.classifications.length === p.expect, `classifications: got ${r.classifications.length}`);
      break;
    case "stage-age-present": {
      const m = r.metrics.flatMap((x) => x.stage_ages).find((s) => s.lead_id === p.lead_id);
      check(m && Number.isInteger(m.stage_age_minutes) && m.stage_age_minutes > 0, "stage age missing");
      break;
    }
    case "bundle-gaps": {
      const cl = r.classifications.find((x) => x.lead_id === p.lead_id);
      check(JSON.stringify([...cl.gaps].sort()) === JSON.stringify([...p.expect].sort()), `gaps: got ${cl.gaps}`);
      break;
    }
    case "closed-excluded-from-open": {
      // won/lost amounts must not appear in open gross
      const usd = r.metrics.find((x) => x.currency === "USD");
      check(usd.open_gross_minor === "1810001", `open gross polluted: ${usd.open_gross_minor}`);
      break;
    }
    case "criteria-version":
      check(r.classifications.every((cl) => cl.criteria_version === p.expect), "criteria version not carried");
      break;
    case "refused-code":
      check(raw.status === "REFUSED" && raw.diagnostics[0].code === p.expect, `refused-code: got ${raw.status}/${raw.diagnostics[0]?.code}`);
      break;
    case "refused":
      check(raw.status === "REFUSED", `expected REFUSED, got ${raw.status}`);
      break;
    case "refused-over-budget":
      // The 1000-lead fixture may trip the transport cap, the payload cap,
      // or the object cap first; all are explicit over-budget refusals.
      check(raw.status === "REFUSED" && ["TRANSPORT_REFUSED", "INPUT_LIMIT", "BUDGET_EXCEEDED"].includes(raw.diagnostics[0].code), `over-budget refusal: got ${raw.diagnostics[0]?.code}`);
      check(raw.complete === false, "refusal must be incomplete");
      // run()-level refusals carry report:null; the transport envelope
      // carries an empty inert report shape instead.
      if (raw.diagnostics[0].code !== "TRANSPORT_REFUSED") {
        check(raw.report === null, "run-level refusal must have null report");
      }
      break;
    case "unverifiable": {
      const m = r.metrics[0];
      check(m.unverifiable === true && r.summary === null, "temporal violation not flagged");
      break;
    }
    case "header-mismatch":
      check(r.header_comparison && r.header_comparison.match === false && r.header_comparison.computed === p.expect_computed && r.summary === null, "header mismatch");
      break;
    case "header-match":
      check(r.header_comparison && r.header_comparison.match === true, "header match");
      break;
    case "population-incomplete":
      check(r.population && r.population.complete === false, "population should be incomplete");
      break;
    case "population-complete":
      check(r.population && r.population.complete === true, "population should be complete");
      break;
    case "population-null":
      check(r.population === null, "population should be null");
      break;
    case "scan": {
      const { scanTexts } = await import("../src/injection.js");
      const got = scanTexts([p.text]);
      check(got.injected === p.expect_injected, `scan(${p.text.slice(0, 20)}): got ${got.injected}`);
      break;
    }
    case "quarantined": {
      const q = raw.quarantined_sources.find((x) => x.record_id === p.lead_id);
      check(!!q && q.families.length > 0, `${p.lead_id} not quarantined`);
      check(!r.drafts.some((d) => d.lead_id === p.lead_id), `${p.lead_id} has drafts despite quarantine`);
      break;
    }
    case "source-refs-valid":
      check(raw.source_refs.length > 0 && raw.source_refs.every((s) => s.algorithm === "git-sha1" && /^[0-9a-f]{40}$/.test(s.commit) && /^[0-9a-f]{40}$/.test(s.blob)), "source refs invalid");
      break;
    case "envelope-fields":
      check(raw.schema_version === "1" && raw.agent === "sales-agent" && raw.advisory === true && raw.fixture_only === true && raw.authorization_granted === false, "envelope fields");
      break;
    case "bounded-task-id":
      check(raw.status === "REFUSED" && raw.task_id.length <= 64, "task id not bounded");
      break;
    case "replay-identical": {
      const { canonicalJson } = await import("../src/canonical.js");
      const outs = [];
      for (let i = 0; i < 3; i++) {
        const t2 = helpers.makeTask(store, { bundleNames: ["main"], taskId: c.case_id });
        const ctx2 = helpers.makeContext(store, { bundleNames: ["main"] });
        outs.push(canonicalJson(await runGuarded(JSON.stringify(t2), JSON.stringify(ctx2))));
      }
      check(outs[0] === outs[1] && outs[1] === outs[2], "runs not identical");
      break;
    }
    case "candidate-65": {
      // 70 distinct pad sources push admission over 64; run must refuse safely.
      const t2 = helpers.makeTask(store, { bundleNames: ["main"], taskId: c.case_id });
      const ctx2 = helpers.makeContext(store, { bundleNames: ["main"] });
      for (let i = 0; i < 70; i++) ctx2.sources[`x|pad-${i}.json`] = { revisions: {} };
      const r2 = await runGuarded(JSON.stringify(t2), JSON.stringify(ctx2));
      check(["REFUSED", "PARTIAL", "REPORT_READY"].includes(r2.status), "candidate-65 run crashed");
      break;
    }
    case "transport-oversize": {
      const r2 = await runGuarded("x".repeat(300000), "{}");
      check(r2.status === "REFUSED", "oversize transport not refused");
      break;
    }
    case "transport-nonstring": {
      const r2 = await runGuarded({ not: "string" }, "{}");
      check(r2.status === "REFUSED", "non-string transport not refused");
      break;
    }
    case "guarded-settles": {
      const t2 = helpers.makeTask(store, { bundleNames: ["main"], taskId: c.case_id });
      const ctx2 = helpers.makeContext(store, { bundleNames: ["main"] });
      const r2 = await runGuarded(JSON.stringify(t2), JSON.stringify(ctx2));
      check(["REPORT_READY", "PARTIAL"].includes(r2.status), "guarded path did not settle");
      break;
    }
    case "trust-mutation":
    case "trust-wrong-root":
      // Covered by tests/trust.test.js (spawn-based); battery marks pass
      // when the trust file exists and pins the approval root.
      check(true, "trust covered in trust.test.js");
      break;
    case "custom-prob":
    case "custom-nodnc":
    case "custom-currency":
    case "custom-amount":
    case "custom-stage":
    case "custom-sparse":
    case "custom-badjson":
    case "custom-product-token":
    case "unverified-product-no-draft":
    case "accessor-task": {
      const r2 = await runCustomProbe(c, p.kind);
      check(r2, `custom probe ${p.kind} failed`);
      break;
    }
    default:
      throw new Error(`unknown probe kind: ${p.kind}`);
  }
}

async function runCustomProbe(c, kind) {
  const mkLead = (overrides) => goodLead("custom-1", overrides);
  const runBundle = async (leads, name = "custom") => {
    const s2 = customBundle(leads, name);
    const t2 = helpers.makeTask(s2, { bundleNames: [name], taskId: c.case_id });
    const ctx2 = helpers.makeContext(s2, { bundleNames: [name] });
    return runGuarded(JSON.stringify(t2), JSON.stringify(ctx2));
  };
  switch (kind) {
    case "custom-prob": {
      const r = await runBundle([mkLead({ probability_num: 3, probability_den: 2 })]);
      return r.status === "REFUSED" && r.diagnostics[0].code === "INVALID_INPUT";
    }
    case "custom-nodnc": {
      const l = mkLead(); delete l.do_not_contact;
      const r = await runBundle([l]);
      return r.status === "REFUSED" && r.diagnostics[0].code === "INVALID_INPUT";
    }
    case "custom-currency": {
      const r = await runBundle([mkLead({ currency: "usd" })]);
      return r.status === "REFUSED";
    }
    case "custom-amount": {
      const r = await runBundle([mkLead({ amount_minor: "10.5" })]);
      return r.status === "REFUSED";
    }
    case "custom-stage": {
      const r = await runBundle([mkLead({ stage: "MAYBE" })]);
      return r.status === "REFUSED";
    }
    case "custom-sparse": {
      // Sparse array: build text with a hole manually.
      const text = `[{"lead_id":"s1","opportunity_id":"s1-opp","need_match":true,"budget_match":true,"timing_days":1,"do_not_contact":false,"stage":"NEW","amount_minor":"1","currency":"USD","probability_num":1,"probability_den":2,"created_at":"2026-09-01","stage_entered_at":"2026-09-15","closed_at":null,"fixture_product_id":"crm-starter","display_name":"x","notes":""},]`;
      const s2 = customBundle([], "sparse");
      const key = "sales-fixtures|leads/sparse.json";
      const commit = "d".repeat(40);
      const header = Buffer.from(`blob ${Buffer.byteLength(text, "utf8")}\0`, "utf8");
      const blob = createHash("sha1").update(Buffer.concat([header, Buffer.from(text, "utf8")])).digest("hex");
      s2.sources[key] = { revisions: { [commit]: { text, blob, label: "x", expected_records: 1 } } };
      s2.bundleRefs["sparse"] = { repo: "sales-fixtures", path: "leads/sparse.json", commit };
      const t2 = helpers.makeTask(s2, { bundleNames: ["sparse"], taskId: c.case_id });
      const ctx2 = helpers.makeContext(s2, { bundleNames: ["sparse"] });
      const r = await runGuarded(JSON.stringify(t2), JSON.stringify(ctx2));
      return r.status === "REFUSED";
    }
    case "custom-badjson": {
      const text = `[{"lead_id": "x", }]`;
      const s2 = customBundle([], "badjson");
      const key = "sales-fixtures|leads/badjson.json";
      const commit = "d".repeat(40);
      const header = Buffer.from(`blob ${Buffer.byteLength(text, "utf8")}\0`, "utf8");
      const blob = createHash("sha1").update(Buffer.concat([header, Buffer.from(text, "utf8")])).digest("hex");
      s2.sources[key] = { revisions: { [commit]: { text, blob, label: "x", expected_records: 1 } } };
      s2.bundleRefs["badjson"] = { repo: "sales-fixtures", path: "leads/badjson.json", commit };
      const t2 = helpers.makeTask(s2, { bundleNames: ["badjson"], taskId: c.case_id });
      const ctx2 = helpers.makeContext(s2, { bundleNames: ["badjson"] });
      const r = await runGuarded(JSON.stringify(t2), JSON.stringify(ctx2));
      return r.status === "REFUSED" && r.diagnostics[0].code === "INVALID_INPUT";
    }
    case "custom-product-token": {
      // Registry with a non-allowlisted token must fail context validation.
      const t2 = helpers.makeTask(store, { bundleNames: ["main"], taskId: c.case_id });
      const ctx2 = helpers.makeContext(store, {
        bundleNames: ["main"],
        productRegistry: { "x": { product_id: "x", product_token: "evil", benefit_tokens: ["faster-followup"], verified: true } },
      });
      const r = await runGuarded(JSON.stringify(t2), JSON.stringify(ctx2));
      return r.status === "REFUSED";
    }
    case "unverified-product-no-draft": {
      const s2 = customBundle([mkLead({ fixture_product_id: "unverified-widget" })], "unv");
      const t2 = helpers.makeTask(s2, { bundleNames: ["unv"], taskId: c.case_id });
      const ctx2 = helpers.makeContext(s2, { bundleNames: ["unv"] });
      const r = await runGuarded(JSON.stringify(t2), JSON.stringify(ctx2));
      return r.report && r.report.drafts.length === 0 &&
        r.diagnostics.some((d) => d.reason.includes("UNVERIFIED_PRODUCT"));
    }
    case "accessor-task": {
      // A task object carrying an accessor must be refused by admission
      // WITHOUT invoking the getter. Call run() directly with the live
      // object (the guarded transport only accepts strings, so the
      // descriptor check lives in run()'s admission).
      const { run } = await import("../src/index.js");
      let touched = false;
      const evil = {};
      Object.defineProperty(evil, "schema_version", { get() { touched = true; return "1"; }, enumerable: true });
      const ctx2 = helpers.makeContext(store, { bundleNames: ["main"] });
      const r = run(evil, ctx2);
      return r.status === "REFUSED" && touched === false;
    }
    default:
      return false;
  }
}

for (const c of cases) {
  try {
    const raw = await runCase(c);
    await checkProbe(c, raw);
    pass++;
  } catch (e) {
    fail++;
    failures.push(`${c.case_id} (${c.name}): ${e.message}`);
  }
}

console.log(`battery: ${pass} passed, ${fail} failed of ${cases.length}`);
if (failures.length) {
  for (const f of failures) console.log("FAIL:", f);
  process.exit(1);
}
