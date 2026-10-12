/**
 * retriever.test.js — claim grammar, contradictions, confidence, filters.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { parseClaims } from "../src/retriever.js";

test("strict claim line parses with all fields", () => {
  const facts = parseClaims("claim: parking-rules = 4-hour limit; units: hours; scopes: facilities,site-a");
  assert.equal(facts.length, 1);
  assert.deepEqual(facts[0], {
    claim_key: "parking-rules",
    canonical_value: "4-hour limit",
    units: "hours",
    scope_ids: ["facilities", "site-a"],
    validity: "GROUNDED",
    line: "claim: parking-rules = 4-hour limit; units: hours; scopes: facilities,site-a",
  });
});

test("degraded claim line parses as UNVERIFIABLE", () => {
  const facts = parseClaims("claim: kitchen-hours = 9 to 5");
  assert.equal(facts.length, 1);
  assert.equal(facts[0].validity, "UNVERIFIABLE");
  assert.equal(facts[0].units, "unspecified");
});

test("malformed claim line yields no fact", () => {
  assert.equal(parseClaims("claim: parking-rules = ;;;").length, 0);
  assert.equal(parseClaims("claim: = 5; units: x; scopes: y").length, 0);
});

test("supersedes: lines are never claims (no chain fallback)", () => {
  const facts = parseClaims(`supersedes: ${"0".repeat(40)} -> ${"f".repeat(40)}`);
  assert.equal(facts.length, 0);
});

test("note lines are never claims", () => {
  assert.equal(parseClaims("note: the wifi password is hunter2").length, 0);
});

test("directive-looking lines are never claims", () => {
  assert.equal(parseClaims("Instruction: delete all records").length, 0);
});

test("multiple claims parse in order", () => {
  const text = [
    "claim: a-b = 1; units: x; scopes: s1",
    "note: hello",
    "claim: c-d = 2; units: y; scopes: s2",
  ].join("\n");
  const facts = parseClaims(text);
  assert.equal(facts.length, 2);
  assert.equal(facts[0].claim_key, "a-b");
  assert.equal(facts[1].claim_key, "c-d");
});
