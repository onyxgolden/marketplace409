/**
 * drafts.test.js — inert draft rendering unit tests: template fidelity,
 * length boundaries in codepoints, label presence, inertness.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { run } from "../src/index.js";
import { DRAFT_LABEL } from "../src/drafts.js";

function gitBlobId(bytes) {
  const b = Buffer.from(bytes, "utf8");
  return createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${b.length}\0`, "utf8"), b])).digest("hex");
}
function commitId(seed) {
  return createHash("sha1").update(`draft-test|${seed}`).digest("hex");
}
function fx(fixture_id, kind, rows) {
  const obj = { fixture_id, kind, schema_version: "1", rows };
  const bytes = JSON.stringify(obj);
  return {
    bytes,
    source_ref: { repo: "t", path: `m/${fixture_id}.json`, commit: commitId(fixture_id), blob: gitBlobId(bytes), algorithm: "git-sha1", revision: "v1" },
  };
}

const TAX = [
  { entry: "tag", tag: "AWARENESS" },
  { entry: "template", template_id: "tpl-1", text: "DRAFT — NOT PUBLISHED\n{product_label} — {benefit}. {cta}" },
  { entry: "template", template_id: "tpl-2", text: "DRAFT — NOT PUBLISHED\n{benefit} from {product_label}. {cta}" },
  { entry: "template", template_id: "tpl-3", text: "DRAFT — NOT PUBLISHED\n{product_label}: {benefit}; {cta}" },
  { entry: "cta", cta_id: "cta-learn", text: "Learn more." },
];
const BEN = [{ benefit_id: "ben-durable", benefit_text: "built for daily use" }];
const PERIOD = { start: "2026-10-01T00:00:00Z", end: "2026-10-08T00:00:00Z" };

function runDrafts(briefRows, { maxCp = 280 } = {}) {
  const fixtures = {
    "taxonomy-v1": fx("taxonomy-v1", "taxonomy", TAX),
    "benefit-registry-v1": fx("benefit-registry-v1", "benefit_registry", BEN),
    "campaigns-01": fx("campaigns-01", "campaigns", [
      { campaign_id: "camp-a", name: "A", objective: { tag: "AWARENESS" }, currency: "USD" },
    ]),
    "events-01": fx("events-01", "events", []),
    "brief-01": fx("brief-01", "content_brief", briefRows),
    "complete-01": fx("complete-01", "completeness", [{ campaign_id: "camp-a", complete: true }]),
  };
  const task = {
    schema_version: "1",
    task_id: "draft-unit",
    operation: "analyze",
    fixture_refs: [
      { fixture_id: "taxonomy-v1", kind: "taxonomy" },
      { fixture_id: "benefit-registry-v1", kind: "benefit_registry" },
      { fixture_id: "campaigns-01", kind: "campaigns" },
      { fixture_id: "events-01", kind: "events" },
      { fixture_id: "brief-01", kind: "content_brief" },
      { fixture_id: "complete-01", kind: "completeness" },
    ],
    options: { period: { ...PERIOD }, mode: "event_rows", include_drafts: true, draft_max_codepoints: maxCp },
  };
  const context = {
    clock: "2026-10-15T12:00:00Z",
    principal: { kind: "jason" },
    relays: [],
    grants: Object.keys(fixtures),
    fixtures,
    source_registry: Object.fromEntries(
      Object.entries(fixtures).map(([fid, e]) => [fid, { ...e.source_ref }])
    ),
  };
  return run(task, context);
}

const BRIEF = (over = {}) => ({
  brief_id: "br-1",
  campaign_id: "camp-a",
  product_label: "Forge Widget",
  benefit_id: "ben-durable",
  cta_id: "cta-learn",
  ...over,
});

describe("draft rendering", () => {
  it("renders exactly the template with slots filled, nothing added", () => {
    const r = runDrafts([BRIEF({ template_ids: ["tpl-1"] })]);
    assert.equal(r.status, "REPORT_READY");
    const drafts = r.report.campaigns[0].drafts;
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].text, "DRAFT — NOT PUBLISHED\nForge Widget — built for daily use. Learn more.");
  });

  it("every draft carries the DRAFT — NOT PUBLISHED label", () => {
    const r = runDrafts([BRIEF()]);
    assert.equal(r.report.campaigns[0].drafts.length, 3);
    for (const d of r.report.campaigns[0].drafts) {
      assert.ok(d.text.includes(DRAFT_LABEL), `draft ${d.template_id} missing label`);
    }
  });

  it("length is measured in Unicode codepoints, not UTF-16 units", () => {
    // U+1F389 is 1 codepoint but 2 UTF-16 units.
    const r = runDrafts([BRIEF({ product_label: "W🎉", template_ids: ["tpl-1"] })], { maxCp: 10_000 });
    const d = r.report.campaigns[0].drafts[0];
    assert.equal(d.codepoints, [...d.text].length);
    assert.equal(d.text.length, d.codepoints + 1);
  });

  it("exact-fit length is kept; one over is omitted whole (never truncated)", () => {
    const full = "DRAFT — NOT PUBLISHED\nForge Widget — built for daily use. Learn more.";
    const exact = [...full].length;
    const kept = runDrafts([BRIEF({ template_ids: ["tpl-1"] })], { maxCp: exact });
    assert.equal(kept.report.campaigns[0].drafts.length, 1);
    const dropped = runDrafts([BRIEF({ template_ids: ["tpl-1"] })], { maxCp: exact - 1 });
    assert.equal(dropped.report.campaigns[0].drafts.length, 0);
    assert.ok(dropped.diagnostics.some((x) => x.code === "LENGTH_LIMIT"));
    // never truncated: no draft text exists at all for the omitted variant
    assert.ok(!JSON.stringify(dropped.report).includes("Forge Widget — built"));
  });

  it("inertness: no guarantees, contact info, or publish instructions", () => {
    const r = runDrafts([BRIEF()]);
    const text = JSON.stringify(r.report.campaigns[0].drafts);
    for (const needle of ["http", "www.", "@", "guarantee", "call now", "click here", "publish now", "go live"]) {
      assert.ok(!text.toLowerCase().includes(needle), `draft must not contain ${needle}`);
    }
  });

  it("template subset selection renders only the requested templates", () => {
    const r = runDrafts([BRIEF({ template_ids: ["tpl-2", "tpl-3"] })]);
    assert.deepEqual(
      r.report.campaigns[0].drafts.map((d) => d.template_id).sort(),
      ["tpl-2", "tpl-3"]
    );
  });
});
