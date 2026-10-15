#!/usr/bin/env node
/**
 * run-manual.js — standalone manual runner for the property-manager
 * prototype. Manual runs only: loads the fixtures, runs one case,
 * prints the JSON result. Not part of the scored path.
 *
 * Usage:
 *   node runner/run-manual.js <SYN-CASE-NNN> [--workflow w] [--claim SYN-RELAY-001,...] [--note "text"] [--markdown]
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/index.js";
import { renderMarkdown } from "../src/markdown.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));
const trust = JSON.parse(readFileSync(join(ROOT, "fixtures", "trust.json"), "utf8"));

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = sortKeys(v[k]);
    return o;
  }
  return v;
}
const canonical = (v) => JSON.stringify(sortKeys(v));
const sha1hex = (b) => createHash("sha1").update(b).digest("hex");
const gitBlobId = (bytes) => sha1hex(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`, "utf8"), bytes]));

const args = process.argv.slice(2);
const caseId = args[0];
if (!caseId || !/^SYN-CASE-[0-9]{3}$/.test(caseId)) {
  console.error("usage: node runner/run-manual.js <SYN-CASE-NNN> [--workflow w] [--claim id,...] [--note \"text\"] [--markdown]");
  process.exit(2);
}
const c = store.cases.find((x) => x.case_id === caseId);
if (!c) {
  console.error(`case ${caseId} is not registered in the fixture store`);
  process.exit(2);
}
const opt = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};

const task = {
  case_ref: {
    case_id: caseId,
    repo: store.repo,
    path: `cases/${caseId}.json`,
    commit: store.commit_id,
    blob: gitBlobId(Buffer.from(canonical(c), "utf8")),
    algorithm: "git-sha1",
    revision: "v1",
  },
  workflow: opt("--workflow") ?? c.workflow,
  context_filters: { property_fixture_ids: [c.property_fixture_id] },
  requested_action: "recommend",
  note: opt("--note") ?? null,
  claimed_relay_ids: opt("--claim") ? opt("--claim").split(",") : [],
};

const context = { clock: Date.now(), caseStore: store, trustRegistry: trust };
const result = run(task, context);
if (args.includes("--markdown")) {
  process.stdout.write(renderMarkdown(result));
} else {
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
