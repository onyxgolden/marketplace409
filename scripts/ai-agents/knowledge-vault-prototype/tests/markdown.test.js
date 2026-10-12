/**
 * markdown.test.js — the Markdown renderer never invents claims.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/index.js";
import { renderMarkdown } from "../src/markdown.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));
const vocabulary = JSON.parse(readFileSync(join(ROOT, "fixtures", "vocabulary.json"), "utf8"));

function ctx() {
  return {
    clock: Date.parse("2026-10-12T12:00:00Z"), vocabulary,
    sources: store.sources,
    readGrants: store.readGrants,
    stewards: store.stewards,
    registrations: store.registrations,
    supersessionRecords: store.supersessionRecords,
  };
}

test("markdown embeds only exact quoted claim text", () => {
  const r = run(
    {
      query: "What is the wifi password?",
      query_key: null,
      filters: { source_tags: [], max_source_age_days: null, as_of_date: null },
      requested_action: "answer",
    },
    ctx()
  );
  const md = renderMarkdown(r);
  for (const c of r.claims) {
    assert.ok(md.includes(`"${c.text}"`), "every claim appears as an exact quote");
  }
  assert.ok(!md.includes("hunter2"));
});

test("markdown renders refusals without claims", () => {
  const r = run(
    {
      query: "What is the wifi password?",
      query_key: null,
      filters: { source_tags: [], max_source_age_days: null, as_of_date: null },
      requested_action: "delete",
    },
    ctx()
  );
  const md = renderMarkdown(r);
  assert.ok(md.includes("REFUSED"));
});
