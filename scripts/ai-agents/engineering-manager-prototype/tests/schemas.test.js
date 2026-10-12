/**
 * schemas.test.js — unit tests for runtime schema validation.
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
  for (const p of want.sort()) assert.ok(seen.has(p));
  const digest = sha(Buffer.from(JSON.stringify(manifest.files.filter((e) => e.path !== "package.json").map((e) => ({ path: e.path, sha256: e.sha256 }))), "utf8"));
  assert.equal(digest, manifest.corpus_digest);
  assert.equal(digest, approved);
}

let schemas;
let run;

const GOOD_REF = {
  repo: "forge-fixture-briefs",
  path: "commands/chatgpt/brief.md",
  commit: "a".repeat(40),
  blob: "b".repeat(40),
  algorithm: "git-sha1",
  revision: "fixture-main",
};

function goodTask() {
  return {
    brief_ref: { ...GOOD_REF },
    objective_id: "obj-1",
    constraints: { budget_units: 10, max_nodes: 10, owner_allowlist: ["muse"] },
    requested_action: "plan",
    related_brief_refs: [],
  };
}

before(async () => {
  authenticateTrustRoot();
  schemas = await import(pathToFileURL(join(ROOT, "src", "schemas.js")).href);
  run = (await import(pathToFileURL(join(ROOT, "src", "index.js")).href)).run;
});

describe("task schema", () => {
  it("accepts a well-formed task", () => {
    assert.equal(schemas.validateTask(goodTask()), null);
  });
  it("rejects unknown task properties", () => {
    assert.match(schemas.validateTask({ ...goodTask(), evil: 1 }), /unknown task property/);
  });
  it("rejects unknown constraint properties", () => {
    const t = goodTask();
    t.constraints = { ...t.constraints, evil: 1 };
    assert.match(schemas.validateTask(t), /unknown constraints property/);
  });
  it("rejects malformed pins", () => {
    const t = goodTask();
    t.brief_ref = { ...GOOD_REF, blob: "xyz" };
    assert.match(schemas.validateTask(t), /blob/);
  });
  it("rejects path traversal", () => {
    const t = goodTask();
    t.brief_ref = { ...GOOD_REF, path: "../../etc/passwd" };
    assert.match(schemas.validateTask(t), /path/);
  });
  it("rejects absolute paths", () => {
    const t = goodTask();
    t.brief_ref = { ...GOOD_REF, path: "/etc/passwd" };
    assert.match(schemas.validateTask(t), /path/);
  });
  it("rejects duplicate allowlist entries", () => {
    const t = goodTask();
    t.constraints.owner_allowlist = ["muse", "muse"];
    assert.match(schemas.validateTask(t), /duplicates/);
  });
  it("rejects non-plan requested_action at plan time with UNSUPPORTED_TASK", () => {
    const t = goodTask();
    t.requested_action = "summarize";
    assert.equal(schemas.validateTask(t), null); // schema allows the string
    const r = run(t, { clock: "2026-10-12T12:00:00Z", briefs: {}, approvals: [], owners: [] });
    assert.equal(r.status, "REFUSED");
    assert.ok(r.diagnostics.some((d) => d.code === "UNSUPPORTED_TASK"));
  });
  it("malformed task yields a structured REFUSED denial, never throws", () => {
    const r = run({ nope: true }, { clock: "2026-10-12T12:00:00Z", briefs: {}, approvals: [], owners: [] });
    assert.equal(r.status, "REFUSED");
    assert.ok(r.diagnostics.some((d) => d.code === "INVALID_INPUT"));
    assert.equal(r.complete, false);
  });
});

describe("date validation", () => {
  it("accepts real dates and UTC instants", () => {
    assert.ok(schemas.isValidDateString("2026-02-28"));
    assert.ok(schemas.isValidDateString("2024-02-29")); // real leap day
    assert.ok(schemas.isValidDateString("2026-10-12T12:00:00Z"));
  });
  it("rejects rollover dates", () => {
    assert.ok(!schemas.isValidDateString("2026-02-30"));
    assert.ok(!schemas.isValidDateString("2026-02-30T12:00:00Z"));
    assert.ok(!schemas.isValidDateString("2023-02-29"));
    assert.ok(!schemas.isValidDateString("2026-13-01"));
    assert.ok(!schemas.isValidDateString("2026-10-12T25:00:00Z"));
    assert.ok(!schemas.isValidDateString("10/12/2026"));
  });
});

describe("brief schema", () => {
  it("rejects unknown brief properties", () => {
    assert.match(schemas.validateBrief({ objective_id: "x", scope_ids: [], task_specs: [], non_goals: [], evil: 1 }), /unknown brief property/);
  });
  it("rejects unknown spec properties", () => {
    const b = {
      objective_id: "x", scope_ids: [], non_goals: [],
      task_specs: [{ local_key: "k", title: "t", owner_proposal: "muse", action_ids: [], dependency_keys: [], acceptance_checks: [], external_gate_ids: [], evil: 1 }],
    };
    assert.match(schemas.validateBrief(b), /unknown property/);
  });
});

describe("approval record schema", () => {
  it("rejects malformed pins and bad enums", () => {
    const rec = {
      record_id: "r", issuer: "jason", subject_ref: null, resource: "p",
      scope_ids: [], action_ids: [], valid_from: "2026-01-01T00:00:00Z",
      expires_at: "2027-01-01T00:00:00Z", revoked: false, nonce: "n",
      source_ref: { ...GOOD_REF }, brief_blob: "z".repeat(40),
      approved_scope_ids: [], approved_action_ids: [],
      authority_origin: "jason", relay_record_id: null,
    };
    assert.match(schemas.validateApprovalRecord(rec), /brief_blob/);
    const rec2 = { ...rec, brief_blob: "a".repeat(40), authority_origin: "president" };
    assert.match(schemas.validateApprovalRecord(rec2), /authority_origin/);
  });
});
