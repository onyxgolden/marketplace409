import test from "node:test";
import assert from "node:assert/strict";
import { renderJobList, renderJobDetail, renderErrorPage } from "../src/render.js";
import { generacDemoDefinition } from "../src/jobs.js";

const JOB = generacDemoDefinition();
const BASE = "/research";

function fakeRun({ itemCount = 2 } = {}) {
  const items = [];
  for (let i = 0; i < itemCount; i++) {
    items.push({
      item_key: `item-key-${i}`,
      claim: `Claim ${i}`,
      evidence_excerpt: `Evidence excerpt ${i}.`,
      evidence_sha256: "a".repeat(64),
      kind: i === 0 ? "fact" : "inference",
      uncertainty: "Some uncertainty.",
      limitations: "Some limitations.",
      recommendation: "Some recommendation.",
      proposed_action: "None.",
    });
  }
  return {
    item_id: "run-0123456789abcdef0123456789abcdef",
    created_from: { job_id: JOB.job_id, job_version: 1, invocation_id: "inv-1", actor: "operator-1" },
    report_digest: "b".repeat(64),
    report: {
      receipt: {
        budget: { items_used: itemCount, items_limit: 64, bytes_used: 100, bytes_limit: 262144, tool_calls_used: 0, tool_calls_limit: 64 },
        empty_claim: null,
      },
      items,
    },
    row_ids: items.map((item) => item.item_key),
    published_at: "2026-11-05T12:00:00Z",
    next_due: "2026-11-10T09:00:00-06:00",
  };
}

test("list renders DISABLED + SYNTHETIC badges and the job title, never an activation control", () => {
  const html = renderJobList({ jobs: [JOB], runsByJob: new Map([[JOB.job_id, null]]), basePath: BASE });
  assert.match(html, /DISABLED/);
  assert.match(html, /SYNTHETIC ONLY/);
  assert.match(html, /Weekly research brief/);
  assert.doesNotMatch(html, /activate/i);
  assert.doesNotMatch(html, /enable (this )?job/i);
  assert.doesNotMatch(html, /schedule/i);
  assert.doesNotMatch(html, /arm/i);
});

test("list shows no-run state and empty-list state", () => {
  const html = renderJobList({ jobs: [JOB], runsByJob: new Map([[JOB.job_id, null]]), basePath: BASE });
  assert.match(html, /No preview yet/);
  const empty = renderJobList({ jobs: [], runsByJob: new Map(), basePath: BASE });
  assert.match(empty, /No disabled research jobs registered/);
});

test("detail renders evidence with citation identity, kind badges, and per-item decision forms", () => {
  const run = fakeRun();
  const html = renderJobDetail({
    job: JOB, run, decisions: null, closed: { closed: false }, invocationId: "inv-9", receiptNote: null, basePath: BASE,
  });
  assert.match(html, /Evidence \(citation byte identity\)/);
  assert.match(html, /a{64}/);
  assert.match(html, /fact/);
  assert.match(html, /inference/);
  assert.match(html, /PENDING/);
  assert.match(html, /Accept for human consideration/);
  assert.match(html, /name="reportDigest" value="b{64}"/);
  assert.match(html, /Run a synthetic preview/);
  assert.match(html, /name="invocation_id" value="inv-9"/);
  assert.doesNotMatch(html, /activate/i);
  assert.doesNotMatch(html, /schedule/i);
});

test("detail renders an empty bundle's meaningful claim and no invented items", () => {
  const run = fakeRun({ itemCount: 0 });
  run.report.receipt.empty_claim = "No synthetic items in corpus 'empty-corpus' for this preview.";
  const html = renderJobDetail({
    job: JOB, run, decisions: null, closed: { closed: true }, invocationId: "inv-9", receiptNote: null, basePath: BASE,
  });
  assert.match(html, /No synthetic items in corpus/);
  assert.match(html, /REVIEW COMPLETE/);
  assert.doesNotMatch(html, /Accept for human consideration/);
});

test("detail with a closed loop shows the completion banner and recorded decisions, not forms", () => {
  const run = fakeRun();
  const decisions = {
    item_id: run.item_id,
    report_digest: run.report_digest,
    revisions: [
      { revision: 1, row_id: "item-key-0", actor: "operator-1", decision: "accept", note: "", at: "2026-11-05T12:00:00Z", decision_id: "d1" },
      { revision: 2, row_id: "item-key-1", actor: "operator-1", decision: "reject", note: "weak evidence", at: "2026-11-05T12:01:00Z", decision_id: "d2" },
    ],
  };
  const html = renderJobDetail({
    job: JOB, run, decisions, closed: { closed: true }, invocationId: "inv-9", receiptNote: null, basePath: BASE,
  });
  assert.match(html, /REVIEW COMPLETE — all 2 items decided/);
  assert.match(html, /ACCEPTED for human consideration/);
  assert.match(html, /REJECTED/);
  assert.match(html, /revision 1/);
  assert.match(html, /weak evidence/);
  assert.doesNotMatch(html, /Accept for human consideration/);
});

test("escaping: a hostile title, claim, excerpt, and note can never break out of the page", () => {
  const evil = `"><script>alert(1)</script><img src=x onerror=alert(2)>`;
  const hostileJob = { ...JOB, title: evil, question: evil };
  const html = renderJobList({ jobs: [hostileJob], runsByJob: new Map([[JOB.job_id, null]]), basePath: BASE });
  // No hostile markup may form a tag: the angle brackets are escaped,
  // so "<script>" and "<img ...>" appear only as escaped text. (The
  // literal substring "onerror=alert" survives escaping inside text —
  // that is harmless; what must never appear is a real tag.)
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  const run = fakeRun();
  run.report.items[0].claim = evil;
  run.report.items[0].evidence_excerpt = evil;
  const detail = renderJobDetail({
    job: JOB, run, decisions: null, closed: { closed: false }, invocationId: "inv-9", receiptNote: evil, basePath: BASE,
  });
  assert.doesNotMatch(detail, /<script>/);
  assert.doesNotMatch(detail, /<img src=x/);
  assert.match(detail, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test("error page escapes its detail and never shows a stack", () => {
  const html = renderErrorPage({ status: 403, code: "PRINCIPAL_MISMATCH", detail: `"><script>alert(1)</script>` });
  assert.match(html, /PRINCIPAL_MISMATCH/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /Error: | at .*\.js:/);
});
