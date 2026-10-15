/**
 * mutation.test.js — corpus mutation regressions. Each test copies the
 * pinned tree to a temp dir, tampers ONE artifact, and asserts the
 * builtins-only verifier (tests/verify-corpus.js) rejects the copy against
 * the ORIGINAL approved root BEFORE any oracle/agent execution or success
 * output. Tampering the oracle helper, expected file, fixture bytes, trust
 * registry or manifest must all stop at verification.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { verifyCorpus } from "./verify-corpus.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APPROVED_ROOT = readFileSync(join(ROOT, "corpus", "corpus_digest.txt"), "utf8").trim();

function freshCopy() {
  const dir = mkdtempSync(join(tmpdir(), "fm-mut-"));
  cpSync(ROOT, dir, { recursive: true });
  return dir;
}

function expectRejected(dir, why) {
  const v = verifyCorpus(dir, APPROVED_ROOT);
  assert.equal(v.ok, false, `tampered tree must be rejected (${why})`);
  return v.reason;
}

test("mutation: tampered src file rejected", () => {
  const dir = freshCopy();
  try {
    const p = join(dir, "src", "index.js");
    writeFileSync(p, readFileSync(p, "utf8") + "\n// tampered\n");
    const reason = expectRejected(dir, "src tamper");
    assert.ok(reason.includes("src/index.js"), reason);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mutation: tampered oracle helper rejected", () => {
  const dir = freshCopy();
  try {
    const p = join(dir, "corpus", "oracle.js");
    writeFileSync(p, readFileSync(p, "utf8").replace("NOT_COMPARABLE", "N_C"));
    const reason = expectRejected(dir, "oracle tamper");
    assert.ok(reason.includes("corpus/oracle.js"), reason);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mutation: tampered expected battery file rejected", () => {
  const dir = freshCopy();
  try {
    const p = join(dir, "corpus", "battery.json");
    const b = JSON.parse(readFileSync(p, "utf8"));
    b.cases[0].expected.sections[0].amounts.expense.budget_minor = "1";
    writeFileSync(p, JSON.stringify(b, null, 2) + "\n");
    const reason = expectRejected(dir, "expected tamper");
    assert.ok(reason.includes("corpus/battery.json"), reason);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mutation: tampered fixture bytes rejected", () => {
  const dir = freshCopy();
  try {
    const p = join(dir, "fixtures", "store.json");
    const s = JSON.parse(readFileSync(p, "utf8"));
    s.fixtures["fm-01"].content.sections[0].lines[0].actual_minor = "1";
    writeFileSync(p, JSON.stringify(s, null, 2) + "\n");
    const reason = expectRejected(dir, "fixture tamper");
    assert.ok(reason.includes("fixtures/store.json"), reason);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mutation: re-pinned manifest after tamper still rejected (root fixed)", () => {
  const dir = freshCopy();
  try {
    // attacker tampers src AND regenerates the manifest — the digest no
    // longer equals the ORIGINAL host-fixed root.
    const p = join(dir, "src", "money.js");
    writeFileSync(p, readFileSync(p, "utf8") + "\n// tampered\n");
    const sha = (b) => createHash("sha256").update(b).digest("hex");
    const manifest = JSON.parse(readFileSync(join(dir, "corpus", "manifest.json"), "utf8"));
    for (const e of manifest.files) {
      e.sha256 = sha(readFileSync(join(dir, e.path)));
    }
    const canonical = JSON.stringify(
      manifest.files.filter((e) => e.path !== "package.json").map((e) => ({ path: e.path, sha256: e.sha256 }))
    );
    manifest.corpus_digest = sha(Buffer.from(canonical, "utf8"));
    writeFileSync(join(dir, "corpus", "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    writeFileSync(join(dir, "corpus", "corpus_digest.txt"), manifest.corpus_digest + "\n");
    const v = verifyCorpus(dir, APPROVED_ROOT);
    assert.equal(v.ok, false);
    assert.ok(v.reason.includes("not the separately trusted approved root"), v.reason);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mutation: deleted pinned file rejected", () => {
  const dir = freshCopy();
  try {
    rmSync(join(dir, "src", "markdown.js"));
    const reason = expectRejected(dir, "deletion");
    assert.ok(reason.includes("src/markdown.js"), reason);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mutation: unlisted file rejected", () => {
  const dir = freshCopy();
  try {
    writeFileSync(join(dir, "src", "evil.js"), "// not pinned\n");
    const reason = expectRejected(dir, "unlisted file");
    assert.ok(reason.includes("unlisted file"), reason);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mutation: pristine copy verifies against the approved root", () => {
  const dir = freshCopy();
  try {
    const v = verifyCorpus(dir, APPROVED_ROOT);
    assert.equal(v.ok, true, v.reason);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
