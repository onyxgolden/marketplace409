/**
 * vocabulary.test.js — bounded query-mapping unit tests.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mapQuery, isPartialCoverage } from "../src/vocabulary.js";

const VOCAB = [
  { query_key: "wifi-password", phrases: ["wifi password", "guest wifi"] },
  { query_key: "vpn-endpoint", phrases: ["vpn server", "vpn endpoint"] },
];

test("single phrase maps to its query_key", () => {
  const m = mapQuery("What is the wifi password?", VOCAB);
  assert.equal(m.status, "ok");
  assert.equal(m.query_key, "wifi-password");
});

test("case-insensitive matching", () => {
  const m = mapQuery("WIFI PASSWORD", VOCAB);
  assert.equal(m.status, "ok");
  assert.equal(m.query_key, "wifi-password");
});

test("unmapped text is unsupported", () => {
  assert.equal(mapQuery("What is the meaning of life?", VOCAB).status, "unsupported");
});

test("two keys matched is ambiguous", () => {
  const m = mapQuery("wifi password and vpn server?", VOCAB);
  assert.equal(m.status, "ambiguous");
  assert.deepEqual(m.candidates, ["vpn-endpoint", "wifi-password"]);
});

test("partial coverage heuristic", () => {
  assert.equal(isPartialCoverage("What is the wifi password?", ["wifi password"]), false);
  assert.equal(isPartialCoverage("What is the wifi password and the holiday schedule for contractors?", ["wifi password"]), true);
});
