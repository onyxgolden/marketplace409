#!/usr/bin/env node
/**
 * run-manual.js — standalone manual runner for the architecture-reviewer
 * prototype. Usage:
 *   node runner/run-manual.js <case-id> [--markdown]
 * Runs one frozen battery case through run() and prints the canonical
 * JSON (or the ADVISORY Markdown preview).
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { run } = await import(join(ROOT, "src", "index.js"));
const { reviewToMarkdown } = await import(join(ROOT, "src", "markdown.js"));
const { canonicalJson } = await import(join(ROOT, "src", "canonical.js"));

const caseId = process.argv[2];
if (!caseId) {
  console.error("usage: node runner/run-manual.js <case-id> [--markdown]");
  process.exit(2);
}
const battery = JSON.parse(readFileSync(join(ROOT, "corpus", "battery.json"), "utf8"));
const c = battery.find((x) => x.case_id === caseId);
if (!c) {
  console.error(`unknown case: ${caseId}`);
  process.exit(2);
}
const key = (r) => `${r.repo}\0${r.path}\0${r.commit}`;
const designs = {};
if (c.fixture.design) designs[key(c.task.design_ref)] = c.fixture.design;
for (const d of c.fixture.extra_designs ?? []) designs[key(d.design_ref)] = d.bytes;
const context = {
  clock: c.fixture.clock,
  designs,
  principals: c.fixture.principals ?? [],
  gatePolicy: c.fixture.gatePolicy ?? {},
  verdicts: c.fixture.verdicts ?? [],
  agreements: c.fixture.agreements ?? [],
};
const result = run(c.task, context);
console.log(process.argv.includes("--markdown") ? reviewToMarkdown(result) : canonicalJson(result));
