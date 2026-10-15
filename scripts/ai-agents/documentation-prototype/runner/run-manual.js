#!/usr/bin/env node
/**
 * run-manual.js — standalone manual runner for the documentation
 * prototype. Manual runs only: loads the fixtures, runs one drift
 * proposal against a chosen fixture pair, prints the JSON result.
 * Not part of the scored path.
 *
 * Usage: node runner/run-manual.js <doc-fixture-id> <code-fixture-id> <behavior-key>
 *   e.g. node runner/run-manual.js D-drift-1 C-drift-1 retry-limit
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/index.js";
import { buildFixtures } from "../fixtures/gen.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const [docId, codeId, behaviorKey] = process.argv.slice(2);
if (!docId || !codeId || !behaviorKey) {
  console.error("usage: node runner/run-manual.js <doc-fixture-id> <code-fixture-id> <behavior-key>");
  process.exit(2);
}

const { sources, specs } = buildFixtures();
const d = specs[docId];
const c = specs[codeId];
if (!d || !c) {
  console.error(`unknown fixture id(s): ${docId} ${codeId}`);
  process.exit(2);
}

const refOf = (s) => ({
  repo: s.repo, path: s.path, commit: s.commit, blob: s.blob,
  algorithm: "git-sha1", revision: "fixture-rev-1",
});

const claimLine = d.text.split("\n").find((l) => l.startsWith("[claim doc] "));
const sentence = claimLine.replace("[claim doc] ", "");
const charIdx = d.text.indexOf(sentence);
const start = Buffer.byteLength(d.text.slice(0, charIdx), "utf8");

const grants = Object.keys(sources).map((k) => {
  const [repo, path] = k.split("|");
  return { repo, path };
});

const result = run(
  {
    repo: "forge",
    doc_ref: refOf(d),
    code_refs: [refOf(c)],
    claim_specs: [{
      claim_id: "manual-claim-1",
      doc_span: {
        quoted_text: sentence,
        start_byte: start,
        end_byte: start + Buffer.byteLength(sentence, "utf8"),
      },
      behavior_key: behaviorKey,
      code_span_ids: [],
      required_usage_span_ids: [],
    }],
    requested_action: "propose",
  },
  { clock: Date.now(), store: { sources }, readGrants: grants }
);
console.log(JSON.stringify(result, null, 2));
