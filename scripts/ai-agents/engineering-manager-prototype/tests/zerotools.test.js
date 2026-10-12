/**
 * zerotools.test.js — zero side-effect evidence for the engineering-manager
 * prototype.
 *
 * The agent has no file-write API, no network, no child processes, no model
 * calls. This test runs the full battery and asserts:
 *  - no new files appear in the module tree,
 *  - the public module surface exposes no write/network/exec capability,
 *  - every result is advisory + fixture-only.
 *
 * Trust: pre-import authentication (builtins only) in before().
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function authenticateTrustRoot() {
  const approved = process.env.EM_APPROVED_ROOT;
  assert.ok(typeof approved === "string" && /^[0-9a-f]{64}$/.test(approved), "trust: missing EM_APPROVED_ROOT");
  const sha = (b) => createHash("sha256").update(b).digest("hex");
  const manifest = JSON.parse(readFileSync(join(ROOT, "corpus", "manifest.json"), "utf8"));
  const seen = new Set();
  for (const e of manifest.files) {
    const p = e?.path;
    assert.ok(typeof p === "string" && p.length > 0 && !p.startsWith("/") && !p.includes("\\") && normalize(p) === p && !p.startsWith("..") && !p.includes("../") && !seen.has(p));
    seen.add(p);
    assert.equal(sha(readFileSync(join(ROOT, p))), e.sha256);
  }
  const digest = sha(Buffer.from(JSON.stringify(manifest.files.filter((e) => e.path !== "package.json").map((e) => ({ path: e.path, sha256: e.sha256 }))), "utf8"));
  assert.equal(digest, manifest.corpus_digest);
  assert.equal(digest, approved);
}

function treeFiles(root) {
  const out = [];
  const walk = (d) => {
    for (const f of readdirSync(d, { withFileTypes: true })) {
      if (f.name.startsWith(".")) continue;
      const p = join(d, f.name);
      if (f.isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(root);
  return out.sort();
}

let planner;

before(async () => {
  authenticateTrustRoot();
  planner = await import(pathToFileURL(join(ROOT, "src", "index.js")).href);
});

describe("zero side effects", () => {
  it("running the full battery creates no files in the module tree", () => {
    const beforeFiles = treeFiles(ROOT);
    const battery = JSON.parse(readFileSync(join(ROOT, "corpus", "battery.json"), "utf8"));
    const NUL = String.fromCharCode(0);
    for (const c of battery) {
      const briefs = {};
      if (c.fixture.brief) briefs[c.task.brief_ref.repo + NUL + c.task.brief_ref.path + NUL + c.task.brief_ref.commit] = { brief: c.fixture.brief, blob: c.task.brief_ref.blob };
      planner.run(c.task, {
        clock: c.fixture.clock,
        briefs,
        approvals: c.fixture.approvals ?? [],
        owners: c.fixture.owners ?? [],
        relays: c.fixture.relays ?? [],
      });
    }
    assert.deepEqual(treeFiles(ROOT), beforeFiles);
  });

  it("public module surface exposes no write/network/exec capability", () => {
    const names = Object.keys(planner).sort();
    for (const n of names) {
      assert.ok(!/write|fetch|http|exec|spawn|socket/i.test(n), `suspicious export: ${n}`);
    }
    for (const f of ["src/index.js", "src/planner.js", "src/schemas.js", "src/approvals.js", "src/canonical.js", "src/injection.js", "src/markdown.js"]) {
      const src = readFileSync(join(ROOT, f), "utf8");
      assert.ok(!/from\s+["']node:(fs|child_process|net|http|https)["']/.test(src), `${f}: forbidden node builtin import`);
      assert.ok(!/\b(eval|Function)\s*\(/.test(src), `${f}: forbidden dynamic evaluation`);
    }
  });

  it("every result is advisory and fixture-only", () => {
    const battery = JSON.parse(readFileSync(join(ROOT, "corpus", "battery.json"), "utf8"));
    const NUL = String.fromCharCode(0);
    for (const c of battery.slice(0, 10)) {
      const briefs = {};
      if (c.fixture.brief) briefs[c.task.brief_ref.repo + NUL + c.task.brief_ref.path + NUL + c.task.brief_ref.commit] = { brief: c.fixture.brief, blob: c.task.brief_ref.blob };
      const r = planner.run(c.task, { clock: c.fixture.clock, briefs, approvals: [], owners: c.fixture.owners ?? [], relays: c.fixture.relays ?? [] });
      assert.equal(r.advisory, true);
      assert.equal(r.fixture_only, true);
      assert.equal(r.schema_version, "1");
    }
  });
});
