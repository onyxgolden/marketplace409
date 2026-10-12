/**
 * determinism.test.js — repeat runs are byte-identical; permutations of
 * independent task declarations yield the same DAG.
 *
 * Trust: same pre-import authentication as battery.test.js (builtins only,
 * before any scored import).
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
  const files = manifest.files;
  const seen = new Set();
  for (const e of files) {
    const p = e?.path;
    assert.ok(typeof p === "string" && p.length > 0 && !p.startsWith("/") && !p.includes("\\") && normalize(p) === p && !p.startsWith("..") && !p.includes("../") && !seen.has(p));
    seen.add(p);
    assert.equal(sha(readFileSync(join(ROOT, p))), e.sha256, `trust: hash mismatch: ${p}`);
  }
  const want = ["package.json", "README.md"];
  for (const dir of ["corpus", "src", "runner", "fixtures", "tests"]) {
    for (const f of readdirSync(join(ROOT, dir)).filter((x) => !x.startsWith("."))) {
      const p2 = `${dir}/${f}`;
      if (p2 === "corpus/manifest.json" || p2 === "corpus/corpus_digest.txt") continue;
      if (dir === "fixtures" || dir === "corpus") {
        if (f.endsWith(".json") || f.endsWith(".js")) want.push(p2);
      } else if (f.endsWith(".js")) {
        want.push(p2);
      }
    }
  }
  for (const p of want.sort()) assert.ok(seen.has(p), `trust: unlisted file: ${p}`);
  const digest = sha(Buffer.from(JSON.stringify(files.filter((e) => e.path !== "package.json").map((e) => ({ path: e.path, sha256: e.sha256 }))), "utf8"));
  assert.equal(digest, manifest.corpus_digest);
  assert.equal(readFileSync(join(ROOT, "corpus", "corpus_digest.txt"), "utf8").trim(), manifest.corpus_digest);
  assert.equal(digest, approved);
  return digest;
}

let run;
let canonicalJson;

const NUL = String.fromCharCode(0);
function briefKey(ref) {
  return ref.repo + NUL + ref.path + NUL + ref.commit;
}

function contextFor(c) {
  const briefs = {};
  if (c.fixture.brief) briefs[briefKey(c.task.brief_ref)] = { brief: c.fixture.brief, blob: c.task.brief_ref.blob };
  for (const r of c.fixture.related_briefs ?? []) briefs[briefKey(r.brief_ref)] = { brief: r.brief, blob: r.brief_ref.blob };
  return {
    clock: c.fixture.clock,
    briefs,
    approvals: c.fixture.approvals ?? [],
    owners: c.fixture.owners ?? [],
    relays: c.fixture.relays ?? [],
  };
}

before(async () => {
  authenticateTrustRoot();
  const planner = await import(pathToFileURL(join(ROOT, "src", "index.js")).href);
  const canon = await import(pathToFileURL(join(ROOT, "src", "canonical.js")).href);
  run = planner.run;
  canonicalJson = canon.canonicalJson;
});

function shuffled(arr, seed) {
  const a = [...arr];
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

describe("determinism", () => {
  it("repeat runs of every case are byte-identical", () => {
    const battery = JSON.parse(readFileSync(join(ROOT, "corpus", "battery.json"), "utf8"));
    for (const c of battery) {
      const ctx = contextFor(c);
      const r1 = canonicalJson(run(c.task, ctx));
      const r2 = canonicalJson(run(c.task, ctx));
      assert.equal(r1, r2, `${c.case_id}: repeat runs differ`);
    }
  });

  it("permutations of independent declarations yield the same DAG", async () => {
    const battery = JSON.parse(readFileSync(join(ROOT, "corpus", "battery.json"), "utf8"));
    // approved chains/branches/joins: shuffle task_specs declaration order
    const targets = battery.filter((c) => ["approved-chain", "approved-branch", "approved-join"].includes(c.category));
    assert.ok(targets.length === 30);
    // EM-001: a permutation changes the serialized brief bytes, so each
    // permuted run carries a NEWLY VALID pin for its own bytes — the old
    // pin must never be accepted for altered bytes. Because node IDs bind
    // the pin, the comparison is over the defined DAG semantics
    // (local-key structural projection), not byte identity.
    const harness = await import(pathToFileURL(join(ROOT, "tests", "harness.js")).href);
    const gitBlobSha1 = (s) => {
      const b = Buffer.from(s, "utf8");
      return createHash("sha1").update(Buffer.from(`blob ${b.length}\0`, "utf8")).update(b).digest("hex");
    };
    for (const c of targets) {
      const ctx = contextFor(c);
      const base = harness.structuralOf(run(c.task, ctx));
      for (let s = 1; s <= 3; s++) {
        const task2 = JSON.parse(JSON.stringify(c.task));
        // shuffle is applied to the fixture brief's task_specs instead
        const brief2 = JSON.parse(JSON.stringify(c.fixture.brief));
        brief2.task_specs = shuffled(brief2.task_specs, s * 7919 + c.case_id.length);
        const newBlob = gitBlobSha1(canonicalJson(brief2));
        task2.brief_ref = { ...task2.brief_ref, blob: newBlob };
        const briefs = {};
        briefs[briefKey(task2.brief_ref)] = { brief: brief2, blob: newBlob };
        const ctx2 = { ...ctx, briefs };
        const r2 = run(task2, ctx2);
        assert.equal(r2.status, "PLANNED", `${c.case_id}: permutation ${s} did not plan`);
        assert.deepEqual(
          harness.structuralOf(r2),
          base,
          `${c.case_id}: permutation ${s} changed the DAG semantics`
        );
      }
    }
  });

  it("stable node IDs are content hashes (64-hex, unique per local_key)", () => {
    const battery = JSON.parse(readFileSync(join(ROOT, "corpus", "battery.json"), "utf8"));
    const c = battery.find((x) => x.case_id === "chain-01");
    const r = run(c.task, contextFor(c));
    const ids = r.nodes.map((n) => n.task_id);
    for (const id of ids) assert.match(id, /^[0-9a-f]{64}$/);
    assert.equal(new Set(ids).size, ids.length);
  });
});
