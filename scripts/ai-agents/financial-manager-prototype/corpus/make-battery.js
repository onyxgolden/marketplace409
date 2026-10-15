#!/usr/bin/env node
/**
 * make-battery.js — AUTHORING TOOL (not part of the scored path).
 *
 * Builds corpus/battery.json: the 12 named discovery fixtures + 40
 * variants. Inputs are canonical task JSON; expected outputs are produced
 * by the INDEPENDENT oracle (corpus/oracle.js), never by src/.
 *
 * With --diff, also runs src/index.js over every case and prints a
 * structural diff of oracle-expected vs implementation-actual so each
 * divergence can be adjudicated against the brief before freezing.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { oracleRun } from "./oracle.js";
import { run } from "../src/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));

const CLOCK = "2026-10-14T12:00:00Z";
const APPROVED = ["forge-ai-drop-fixtures"];

const LIVE_REF = {
  repo: "live-ledger",
  path: "ledger/accounts.json",
  commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  blob: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  algorithm: "git-sha1",
  revision: "3",
};

const CASE_ORDER = [
  "fm-01", "fm-02", "fm-03", "fm-04", "fm-05", "fm-06",
  "fm-07", "fm-08", "fm-09", "fm-10", "fm-11", "fm-12",
  ...Array.from({ length: 40 }, (_, i) => "fm-v" + String(i + 1).padStart(2, "0")),
];

const ACTION_OVERRIDE = { "fm-v34": "issue_statement", "fm-v35": "publish_report" };

function buildTask(fixtureId) {
  if (fixtureId === "fm-11") {
    return {
      task_id: "battery-fm-11",
      bundle_refs: [LIVE_REF],
      period_ids: [],
      requested_action: "assemble_draft",
    };
  }
  return {
    task_id: "battery-" + fixtureId,
    bundle_refs: [store.fixtures[fixtureId].source_ref],
    period_ids: [],
    requested_action: ACTION_OVERRIDE[fixtureId] || "assemble_draft",
  };
}

function buildContext() {
  return { clock: CLOCK, fixtureStore: store, approvedRepos: APPROVED };
}

function diffPaths(a, b, path, out) {
  if (out.length > 40) return;
  if (typeof a !== typeof b) {
    out.push(`${path}: type ${typeof a} vs ${typeof b}`);
    return;
  }
  if (a === null || b === null || typeof a !== "object") {
    if (!Object.is(a, b)) out.push(`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
    return;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    out.push(`${path}: array vs object`);
    return;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (!(k in a)) out.push(`${path}.${k}: missing in oracle`);
    else if (!(k in b)) out.push(`${path}.${k}: missing in implementation`);
    else diffPaths(a[k], b[k], `${path}.${k}`, out);
  }
}

const cases = [];
let diffCount = 0;
for (const fid of CASE_ORDER) {
  const task = buildTask(fid);
  const expected = oracleRun(task, buildContext());
  cases.push({
    case_id: fid,
    name: store.fixtures[fid].description,
    input: {
      task,
      fixture_ids: fid === "fm-11" ? [] : [fid],
      clock: CLOCK,
    },
    expected,
  });
  if (process.argv.includes("--diff")) {
    const actual = run(task, buildContext());
    const diffs = [];
    diffPaths(expected, actual, "$", diffs);
    if (diffs.length > 0) {
      diffCount++;
      console.log(`--- DIFF ${fid} (${diffs.length}) ---`);
      for (const d of diffs.slice(0, 12)) console.log("  " + d);
    }
  }
}

if (!process.argv.includes("--diff")) {
  writeFileSync(join(ROOT, "corpus", "battery.json"), JSON.stringify({ generated_by: "corpus/oracle.js (independent)", cases }, null, 2) + "\n");
  console.log(`wrote corpus/battery.json with ${cases.length} cases`);
} else {
  console.log(`\ndiff summary: ${diffCount}/${cases.length} cases diverge`);
}
