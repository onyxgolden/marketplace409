/**
 * markdown.test.js — the Markdown renderer consumes the JSON result only and
 * invents no claims. The watermark appears in the document head, every
 * rendered section, and the footer.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadStore, makeContext, run } from "./harness.js";
import { renderMarkdown } from "../src/markdown.js";
import { WATERMARK } from "../src/index.js";

test("markdown: watermark in head, every section, and footer", () => {
  const store = loadStore();
  const r = run(
    {
      task_id: "t",
      bundle_refs: [store.fixtures["fm-12"].source_ref],
      period_ids: [],
      requested_action: "assemble_draft",
    },
    makeContext(store)
  );
  const md = renderMarkdown(r);
  const first = md.indexOf(WATERMARK);
  assert.ok(first >= 0 && first < 200, "watermark near the head");
  const sections = md.split("## Section");
  assert.equal(sections.length - 1, 2, "two rendered sections");
  for (const s of sections.slice(1)) {
    assert.ok(s.includes(WATERMARK), "every rendered section carries the watermark");
  }
  assert.ok(md.trimEnd().endsWith(`_${WATERMARK}_`), "watermark in the footer");
});

test("markdown: figures come from the JSON result, nothing invented", () => {
  const store = loadStore();
  const r = run(
    {
      task_id: "t",
      bundle_refs: [store.fixtures["fm-01"].source_ref],
      period_ids: [],
      requested_action: "assemble_draft",
    },
    makeContext(store)
  );
  const md = renderMarkdown(r);
  for (const fig of ["165000", "143700", "-21300", "-17.92%", "attributed-only"]) {
    assert.ok(md.includes(fig), `expected figure ${fig} in markdown`);
  }
  assert.ok(!md.includes("AUD"), "no invented currency");
  assert.ok(!md.includes("favorable (projected)"), "no invented qualifiers");
});

test("markdown: refused result renders watermark with no section blocks", () => {
  const store = loadStore();
  const r = run(
    {
      task_id: "t",
      bundle_refs: [store.fixtures["fm-04"].source_ref],
      period_ids: [],
      requested_action: "assemble_draft",
    },
    makeContext(store)
  );
  assert.equal(r.status, "REFUSED");
  const md = renderMarkdown(r);
  assert.ok(md.includes(WATERMARK));
  assert.ok(md.includes("REFUSED"));
  assert.ok(!md.includes("## Section"), "no section blocks on refusal");
  assert.ok(!md.includes("SYNTHETIC-CANARY"), "no payload echo in markdown");
});
