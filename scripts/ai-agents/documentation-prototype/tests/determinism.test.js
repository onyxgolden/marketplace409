/**
 * determinism.test.js — repeat runs are byte-identical under a fixed
 * context; detached snapshots cannot be mutated by the caller.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/index.js";
import { canonicalJson } from "../src/canonical.js";
import { buildContext } from "./harness.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadCase(i) {
  const battery = JSON.parse(readFileSync(join(ROOT, "corpus", "battery.json"), "utf8"));
  return battery[i];
}

test("same task twice -> byte-identical canonical JSON", () => {
  for (const i of [0, 42, 85, 121, 155, 183]) {
    const c = loadCase(i);
    const { context } = buildContext(ROOT, c);
    const a = run(JSON.parse(JSON.stringify(c.task)), context);
    const { context: context2 } = buildContext(ROOT, c);
    const b = run(JSON.parse(JSON.stringify(c.task)), context2);
    assert.equal(canonicalJson(a), canonicalJson(b), `case ${c.case_id} not deterministic`);
  }
});

test("caller mutation of a returned result cannot alter a later run", () => {
  const c = loadCase(0);
  const { context } = buildContext(ROOT, c);
  const a = run(JSON.parse(JSON.stringify(c.task)), context);
  a.claims.push({ claim_id: "forged", support_status: "DRIFTED" });
  a.status = "REFUSED";
  const { context: context2 } = buildContext(ROOT, c);
  const b = run(JSON.parse(JSON.stringify(c.task)), context2);
  assert.equal(b.status, "READY");
  assert.equal(b.claims.length, 1);
  assert.equal(b.claims[0].claim_id, "dd-claim-drift-1");
});

test("unchanged evidence yields no drift on rescan", () => {
  const c = loadCase(40); // a no-change case
  const { context } = buildContext(ROOT, c);
  const a = run(JSON.parse(JSON.stringify(c.task)), context);
  const { context: context2 } = buildContext(ROOT, c);
  const b = run(JSON.parse(JSON.stringify(c.task)), context2);
  assert.equal(a.status, "READY");
  assert.equal(b.proposed_diff.hunks.length, 0);
  assert.equal(b.proposed_diff.no_change, true);
  assert.equal(canonicalJson(a.proposed_diff), canonicalJson(b.proposed_diff));
});
