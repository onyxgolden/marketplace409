/**
 * byteranges.test.js — DOC-001 regression: UTF-8 byte offsets must never
 * be applied as JavaScript string indexes.
 *
 * Covers: multibyte (2-byte, 3-byte, 4-byte) text preceding a claim phrase
 * on the same doc line; the proposed diff must replace exactly the claim
 * phrase and leave neighboring multibyte text byte-identical. Also runs
 * the host diff-bound validator over the result.
 *
 * Negative proof: the pre-fix computation (byte offset used as a string
 * index, and byte+char offset mixing) is reproduced inline and asserted
 * to corrupt the line, while the fixed pipeline produces the exact
 * expected after-text.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/index.js";
import { gitBlobId } from "../src/canonical.js";
import { validateDiffBounds } from "./harness.js";

const COMMIT = "a".repeat(40);

function makeStore(docText, codeText) {
  const docBytes = Buffer.from(docText, "utf8");
  const codeBytes = Buffer.from(codeText, "utf8");
  const docBlob = gitBlobId(docBytes);
  const codeBlob = gitBlobId(codeBytes);
  const docRef = { repo: "forge", path: "runbooks/byte-1.md", commit: COMMIT, blob: docBlob, algorithm: "git-sha1", revision: "byte-rev-1" };
  const codeRef = { repo: "forge", path: "billing/src/byte_1.py", commit: COMMIT, blob: codeBlob, algorithm: "git-sha1", revision: "byte-rev-1" };
  return {
    docRef,
    codeRef,
    store: {
      sources: {
        "forge|runbooks/byte-1.md": { kind: "doc", revisions: { [COMMIT]: { text: docText } } },
        "forge|billing/src/byte_1.py": { kind: "code", revisions: { [COMMIT]: { text: codeText } } },
      },
    },
  };
}

function makeTask(docRef, codeRef, quotedText, startByte) {
  const endByte = startByte + Buffer.byteLength(quotedText, "utf8");
  return {
    repo: "forge",
    doc_ref: docRef,
    code_refs: [codeRef],
    requested_action: "propose",
    claim_specs: [
      {
        claim_id: "byte-claim-1",
        behavior_key: "retry-limit",
        doc_span: { quoted_text: quotedText, start_byte: startByte, end_byte: endByte },
        code_span_ids: [],
        required_usage_span_ids: [],
      },
    ],
  };
}

function makeContext(store) {
  const grants = [
    { repo: "forge", path: "runbooks/byte-1.md" },
    { repo: "forge", path: "billing/src/byte_1.py" },
  ];
  return { clock: Date.now(), store, readGrants: grants };
}

const CODE = [
  "const MAX_RETRIES = 3;",
  "retry_queue.configure(MAX_RETRIES);",
  "",
].join("\n");

// Each case: [label, multibyte prefix placed before the claim on the line]
const PREFIXES = [
  ["2-byte latin", "Café naïve résumé — "],
  ["3-byte CJK", "日本語テスト — "],
  ["4-byte emoji", "🚀🔥💯 — "],
  ["mixed", "Café 日本語 🚀 — "],
];

for (const [label, prefix] of PREFIXES) {
  test(`DOC-001 byte-range diff with ${label} prefix: phrase replaced exactly, neighbors intact`, () => {
    const quoted = "The invoice client retries failed submissions up to 5 attempts.";
    const docText = `# Byte runbook\n${prefix}${quoted}\nTrailing line.\n`;
    const lineText = `${prefix}${quoted}`;
    const spanStart = Buffer.byteLength(`# Byte runbook\n${prefix}`, "utf8");
    const { docRef, codeRef, store } = makeStore(docText, CODE);
    const task = makeTask(docRef, codeRef, quoted, spanStart);
    const result = run(task, makeContext(store));

    assert.equal(result.status, "READY", `expected READY, got ${result.status}: ${JSON.stringify(result.diagnostics).slice(0, 200)}`);
    assert.equal(result.claims.length, 1);
    assert.equal(result.claims[0].support_status, "DRIFTED");

    const diff = result.proposed_diff;
    assert.ok(diff && diff.hunks.length === 1, "expected exactly one hunk");
    const hunk = diff.hunks[0];
    assert.deepEqual(hunk.before, [lineText]);
    const expectedAfter = `${prefix}The invoice client retries failed submissions up to 3 attempts.`;
    assert.deepEqual(hunk.after, [expectedAfter], `after-line wrong for ${label}`);

    // The multibyte prefix must be byte-identical before/after.
    const beforePrefixBytes = Buffer.from(hunk.before[0].slice(0, prefix.length), "utf8");
    const afterPrefixBytes = Buffer.from(hunk.after[0].slice(0, prefix.length), "utf8");
    assert.ok(beforePrefixBytes.equals(afterPrefixBytes), `multibyte prefix corrupted for ${label}`);

    // Host validator: before lines match, only the cited line changed.
    const bound = validateDiffBounds(result, task, docText);
    assert.equal(bound.ok, true, `host validator failed for ${label}: ${bound.reason}`);

    // source_refs populated (DOC-003): doc + non-quarantined code ref.
    assert.deepEqual(
      result.source_refs.map((r) => r.path),
      ["runbooks/byte-1.md", "billing/src/byte_1.py"],
      "source_refs must list the verified doc and code refs"
    );
  });
}

test("DOC-001 negative: pre-fix byte-as-char computation corrupts the line", () => {
  // Reproduce the old buggy math: relStart/relEnd from byte offsets used
  // as String.slice indexes, and byte+char offset mixing.
  const prefix = "Café — "; // 'é' is 2 bytes, 1 char
  const quoted = "The invoice client retries failed submissions up to 5 attempts.";
  const lineText = `${prefix}${quoted}`;
  const lineStartByte = 100; // arbitrary absolute line start
  const spanStartByte = lineStartByte + Buffer.byteLength(prefix, "utf8");
  // Old code: absStart = spanStartByte + phrase_start (char index!)
  const phraseCharStart = quoted.indexOf("5 attempts");
  const oldAbsStart = spanStartByte + phraseCharStart; // BUG: mixes byte + char
  const oldRelStart = oldAbsStart - lineStartByte; // used as string index: BUG
  const oldRelEnd = oldRelStart + "5 attempts".length;
  const buggyAfter = lineText.slice(0, oldRelStart) + "3 attempts" + lineText.slice(oldRelEnd);
  const correctAfter = `${prefix}The invoice client retries failed submissions up to 3 attempts.`;
  assert.notEqual(buggyAfter, correctAfter, "old math must corrupt the line (otherwise the test proves nothing)");
  assert.ok(buggyAfter.includes("5 a3 attempts"), `old math must misplace the replacement, got: ${buggyAfter}`);
});

test("DOC-001: phrase at line start with multibyte text later on the line", () => {
  const quoted = "The invoice client retries failed submissions up to 5 attempts.";
  const suffix = " — café ☕🚀";
  const docText = `# Byte runbook\n${quoted}${suffix}\n`;
  const spanStart = Buffer.byteLength("# Byte runbook\n", "utf8");
  const { docRef, codeRef, store } = makeStore(docText, CODE);
  const task = makeTask(docRef, codeRef, quoted, spanStart);
  const result = run(task, makeContext(store));
  assert.equal(result.status, "READY");
  const hunk = result.proposed_diff.hunks[0];
  assert.deepEqual(hunk.after, [`The invoice client retries failed submissions up to 3 attempts.${suffix}`]);
  const bound = validateDiffBounds(result, task, docText);
  assert.equal(bound.ok, true, bound.reason);
});

test("DOC-003: quarantined code ref excluded from source_refs, denial has empty source_refs", () => {
  const quoted = "The invoice client retries failed submissions up to 5 attempts.";
  const docText = `# Byte runbook\n${quoted}\n`;
  const spanStart = Buffer.byteLength("# Byte runbook\n", "utf8");
  const goodCode = ["const MAX_RETRIES = 3;", "retry_queue.configure(MAX_RETRIES);", ""].join("\n");
  const badCode = ["# ISO 27001 certified", "const MAX_RETRIES = 3;", "retry_queue.configure(MAX_RETRIES);", ""].join("\n");

  const mkRef = (path, text) => {
    const blob = gitBlobId(Buffer.from(text, "utf8"));
    return { repo: "forge", path, commit: COMMIT, blob, algorithm: "git-sha1", revision: "byte-rev-1" };
  };
  const docRef = mkRef("runbooks/byte-1.md", docText);
  const goodRef = mkRef("billing/src/byte_1.py", goodCode);
  const badRef = mkRef("billing/src/byte_2.py", badCode);
  const store = {
    sources: {
      "forge|runbooks/byte-1.md": { kind: "doc", revisions: { [COMMIT]: { text: docText } } },
      "forge|billing/src/byte_1.py": { kind: "code", revisions: { [COMMIT]: { text: goodCode } } },
      "forge|billing/src/byte_2.py": { kind: "code", revisions: { [COMMIT]: { text: badCode } } },
    },
  };
  const endByte = spanStart + Buffer.byteLength(quoted, "utf8");
  const task = {
    repo: "forge",
    doc_ref: docRef,
    code_refs: [goodRef, badRef],
    requested_action: "propose",
    claim_specs: [
      {
        claim_id: "byte-claim-q",
        behavior_key: "retry-limit",
        doc_span: { quoted_text: quoted, start_byte: spanStart, end_byte: endByte },
        code_span_ids: [],
        required_usage_span_ids: [],
      },
    ],
  };
  const grants = [
    { repo: "forge", path: "runbooks/byte-1.md" },
    { repo: "forge", path: "billing/src/byte_1.py" },
    { repo: "forge", path: "billing/src/byte_2.py" },
  ];
  const result = run(task, { clock: Date.now(), store, readGrants: grants });
  assert.equal(result.status, "READY");
  assert.ok(result.quarantined_sources.some((q) => q.path === "billing/src/byte_2.py"), "bad code ref must be quarantined");
  assert.deepEqual(
    result.source_refs.map((r) => r.path),
    ["runbooks/byte-1.md", "billing/src/byte_1.py"],
    "quarantined code ref must be excluded from source_refs"
  );

  // Denial path: missing grant -> BLOCKED with only verified sources (doc was verified).
  const denied = run(task, { clock: Date.now(), store, readGrants: grants.slice(0, 1) });
  assert.equal(denied.status, "BLOCKED");
  assert.deepEqual(
    denied.source_refs.map((r) => r.path),
    ["runbooks/byte-1.md"],
    "BLOCKED denial lists only the verified doc ref"
  );
});
