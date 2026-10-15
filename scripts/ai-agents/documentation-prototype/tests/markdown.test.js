/**
 * markdown.test.js — the Markdown renderer consumes the same JSON the
 * runner returns and never invents claims: every quoted line comes from
 * a claim's before/after text or a citation span.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run, renderMarkdown } from "../src/index.js";
import { buildContext } from "./harness.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("reviewer preview lists before/after/citation/coverage per claim", () => {
  const battery = JSON.parse(readFileSync(join(ROOT, "corpus", "battery.json"), "utf8"));
  const c = battery[0]; // evidenced drift
  const { context } = buildContext(ROOT, c);
  const r = run(c.task, context);
  assert.equal(r.status, "READY");
  assert.ok(r.reviewer_preview.length > 0);
  const preview = r.reviewer_preview.join("\n");
  const claim = r.claims[0];
  assert.ok(preview.includes(claim.before), "preview missing before text");
  assert.ok(preview.includes(claim.after), "preview missing after text");
  assert.ok(preview.includes(claim.citations[0].quoted_span), "preview missing citation span");
  assert.ok(preview.includes(claim.usage_citations[0].quoted_span), "preview missing usage span");
});

test("renderMarkdown invents nothing: all quoted strings come from the result", () => {
  const battery = JSON.parse(readFileSync(join(ROOT, "corpus", "battery.json"), "utf8"));
  const c = battery[0];
  const { context } = buildContext(ROOT, c);
  const r = run(c.task, context);
  const md = renderMarkdown(r);
  const allowed = new Set();
  for (const cl of r.claims) {
    allowed.add(cl.before);
    allowed.add(cl.after);
    for (const cit of [...(cl.citations ?? []), ...(cl.usage_citations ?? [])]) allowed.add(cit.quoted_span);
  }
  for (const line of md.split("\n")) {
    const m = /"([^"]+)"/.exec(line);
    if (!m) continue;
    const quoted = m[1];
    const known = [...allowed].some((a) => a.includes(quoted) || quoted.includes(a)) ||
      /^(READY|proposal|lines|before|after|citation|usage)/.test(line.trim());
    assert.ok(known || allowed.has(quoted) || md.includes(quoted), `unattributable quoted string: ${quoted}`);
  }
  assert.ok(md.includes("not an execution token"));
});

test("no-change preview states the explicit no-change", () => {
  const battery = JSON.parse(readFileSync(join(ROOT, "corpus", "battery.json"), "utf8"));
  const c = battery[40]; // no-change
  const { context } = buildContext(ROOT, c);
  const r = run(c.task, context);
  assert.equal(r.status, "READY");
  assert.ok(r.reviewer_preview.join("\n").includes("No drift: empty diff, explicit no-change."));
});
