/**
 * identity-vectors.test.js — contract tests for the operation-identity
 * fixture pack (FORGE-P-20261021-CHATGPT-IDENTITY-TUPLE-VECTORS).
 *
 * Every test runs through the pack's public entrypoints (checkEncoder /
 * checkLedger / OperationLedger) with the two shipped sample encoders.
 * Node builtins only (node:test + node:assert/strict). Run with:
 *   node scripts/ai-agents/identity-vectors/tests/run-tests.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  BOUND_FIELDS,
  KEY_VECTORS,
  LEDGER_SCENARIOS,
  colonJoinEncoder,
  lengthPrefixEncoder,
  checkEncoder,
  checkLedger,
  OperationLedger,
  canonicalPayloadHash,
  BASE_TUPLE,
} from "../identity-vectors.js";

// ---------------------------------------------------------------- pack hygiene

test("pack hygiene: vector ids unique, every vector well-formed", () => {
  const ids = KEY_VECTORS.map((v) => v.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate vector id");
  for (const v of KEY_VECTORS) {
    assert.equal(typeof v.id, "string");
    assert.equal(typeof v.name, "string");
    assert.equal(typeof v.category, "string");
    assert.ok(v.expect === "SAME" || v.expect === "DISTINCT", `${v.id}: bad expect`);
    assert.equal(typeof v.a, "object");
    assert.equal(typeof v.b, "object");
    assert.equal(typeof v.catches, "string");
  }
  const ledgerIds = LEDGER_SCENARIOS.map((s) => s.id);
  assert.equal(new Set(ledgerIds).size, ledgerIds.length, "duplicate scenario id");
});

test("pack hygiene: every vector identifier is obviously synthetic (condition 1)", () => {
  const forbidden = ["@", "morgan", "jason", "brandy", "tenant"];
  const strings = [];
  const collect = (value) => {
    if (typeof value === "string") strings.push(value);
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  };
  KEY_VECTORS.forEach((v) => {
    collect(v.a);
    collect(v.b);
  });
  assert.ok(strings.length > 0);
  for (const s of strings) {
    for (const bad of forbidden) {
      assert.ok(!s.toLowerCase().includes(bad), `non-synthetic content in vector: ${JSON.stringify(s)}`);
    }
  }
  // The bound field set is the contract: every vector tuple uses only it.
  for (const v of KEY_VECTORS) {
    for (const side of [v.a, v.b]) {
      for (const key of Object.keys(side)) {
        assert.ok(BOUND_FIELDS.includes(key), `${v.id}: unknown field ${key}`);
      }
    }
  }
});

test("pack hygiene: base tuple binds every field", () => {
  for (const f of BOUND_FIELDS) {
    assert.ok(BASE_TUPLE[f] !== undefined, `BASE_TUPLE missing ${f}`);
  }
});

// ---------------------------------------------------------------- key vectors

test("length-prefix encoder passes every key vector (16/16)", () => {
  const result = checkEncoder(lengthPrefixEncoder);
  assert.equal(result.total, 16);
  assert.equal(result.failed, 0, JSON.stringify(result.results.filter((r) => !r.pass), null, 2));
  assert.equal(result.passed, 16);
});

test("colon-join encoder fails exactly the ambiguous vectors", () => {
  const result = checkEncoder(colonJoinEncoder);
  const failed = result.results.filter((r) => !r.pass).map((r) => r.id).sort();
  // The deliberately ambiguous encoder: delimiter collisions (V-01, V-02,
  // V-15, V-16) plus the empty-vs-absent collapse (V-03, V-04 — it coerces
  // undefined to "").
  assert.deepEqual(failed, ["V-01", "V-02", "V-03", "V-04", "V-15", "V-16"]);
  // And the collision is real: the two keys are byte-identical.
  for (const id of failed) {
    const r = result.results.find((x) => x.id === id);
    assert.equal(r.keyA, r.keyB, `${id}: expected identical keys`);
  }
});

test("positive control V-13: identical tuples share a key under both encoders", () => {
  for (const encode of [colonJoinEncoder, lengthPrefixEncoder]) {
    const r = checkEncoder(encode).results.find((x) => x.id === "V-13");
    assert.equal(r.pass, true);
    assert.equal(r.keyA, r.keyB);
  }
});

test("JSON-hostile vectors stay distinct under both encoders", () => {
  for (const encode of [colonJoinEncoder, lengthPrefixEncoder]) {
    const result = checkEncoder(encode);
    for (const id of ["V-05", "V-06", "V-07"]) {
      const r = result.results.find((x) => x.id === id);
      assert.equal(r.pass, true, `${id} failed under ${encode.name}`);
      assert.notEqual(r.keyA, r.keyB);
    }
  }
});

test("unicode vectors stay distinct under both encoders", () => {
  for (const encode of [colonJoinEncoder, lengthPrefixEncoder]) {
    const result = checkEncoder(encode);
    for (const id of ["V-08", "V-09"]) {
      const r = result.results.find((x) => x.id === id);
      assert.equal(r.pass, true, `${id} failed under ${encode.name}`);
    }
  }
});

test("checkEncoder records a throwing encoder as a vector failure, not a crash", () => {
  const throwing = (fields) => {
    if (String(fields.reason || "").includes('"')) throw new Error("unescaped quote");
    return lengthPrefixEncoder(fields);
  };
  const result = checkEncoder(throwing);
  const v05 = result.results.find((r) => r.id === "V-05");
  assert.equal(v05.pass, false);
  assert.match(v05.error, /unescaped quote/);
  assert.equal(result.total, 16);
});

test("encoders are deterministic: same input, same key, twice", () => {
  for (const encode of [colonJoinEncoder, lengthPrefixEncoder]) {
    for (const v of KEY_VECTORS) {
      assert.equal(encode(v.a), encode(v.a));
      assert.equal(encode(v.b), encode(v.b));
    }
  }
});

test("canonical payload hash: equal payloads hash equal, key order irrelevant", () => {
  const a = { b: 1, a: { y: 2, x: 1 } };
  const b = { a: { x: 1, y: 2 }, b: 1 };
  assert.equal(canonicalPayloadHash(a), canonicalPayloadHash(b));
  assert.notEqual(canonicalPayloadHash({ ...BASE_TUPLE }), canonicalPayloadHash({ ...BASE_TUPLE, reason: "other" }));
});

// ---------------------------------------------------------------- ledger vectors

test("ledger L-01..L-05 all pass under the length-prefix encoder", () => {
  const result = checkLedger(lengthPrefixEncoder);
  assert.equal(result.total, 6);
  assert.equal(result.failed, 0, JSON.stringify(result.results.filter((r) => !r.pass), null, 2));
});

test("ledger L-01..L-05 all pass under the colon-join encoder (ledger refuses, never falsely succeeds)", () => {
  const result = checkLedger(colonJoinEncoder);
  assert.equal(result.total, 6);
  assert.equal(result.failed, 0, JSON.stringify(result.results.filter((r) => !r.pass), null, 2));
});

test("ledger L-03 distinguishes the encoders: collision refused vs distinct insert", () => {
  const bad = new OperationLedger(colonJoinEncoder);
  bad.submit({ fields: { ...BASE_TUPLE, obligation: "obl-1", actor: "actor-A:x", reason: "r-1" } });
  const collided = bad.submit({ fields: { ...BASE_TUPLE, obligation: "obl-1:actor-A", actor: "x", reason: "r-1" } });
  assert.equal(collided.outcome, "CONFLICT");
  assert.equal(bad.eventCount, 1);

  const good = new OperationLedger(lengthPrefixEncoder);
  good.submit({ fields: { ...BASE_TUPLE, obligation: "obl-1", actor: "actor-A:x", reason: "r-1" } });
  const distinct = good.submit({ fields: { ...BASE_TUPLE, obligation: "obl-1:actor-A", actor: "x", reason: "r-1" } });
  assert.equal(distinct.outcome, "INSERTED");
  assert.equal(good.eventCount, 2);
});

test("ledger tamper: key-preserving mutation is caught by the payload hash alone", () => {
  // Direct proof of the L-04b mechanism: the mutation leaves the
  // colon-joined key byte-identical, so only the hash can see it.
  const fieldsBefore = { ...BASE_TUPLE, obligation: "obl-1", actor: "actor-A:x", reason: "r-1" };
  const fieldsAfter = { ...BASE_TUPLE, obligation: "obl-1", actor: "actor-A", reason: "x:r-1" };
  assert.equal(colonJoinEncoder(fieldsBefore), colonJoinEncoder(fieldsAfter));
  assert.notEqual(canonicalPayloadHash(fieldsBefore), canonicalPayloadHash(fieldsAfter));
});
