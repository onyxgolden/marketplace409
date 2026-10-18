/** classifier.test.js — chart classification tests. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyAccount, cashMovement } from "../src/classifier.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));
const CHART = store.criteriaPresets.standard.chart;

test("classifyAccount: exact code lookup", () => {
  assert.deepEqual(classifyAccount("REV001", CHART), { class: "INCOME", known: true });
  assert.deepEqual(classifyAccount("EXP002", CHART), { class: "EXPENSE", known: true });
  assert.deepEqual(classifyAccount("TRF001", CHART), { class: "TRANSFER", known: true });
});

test("classifyAccount: unknown code", () => {
  assert.deepEqual(classifyAccount("ZZZ999", CHART), { class: "UNKNOWN", known: false });
});

test("classifyAccount: no keyword interpretation", () => {
  // "REVENUE" contains "REV" but is not an exact code
  assert.deepEqual(classifyAccount("REVENUE", CHART), { class: "UNKNOWN", known: false });
  assert.deepEqual(classifyAccount("rev001", CHART), { class: "UNKNOWN", known: false }); // case-sensitive
});

test("cashMovement: IN adds signed amount", () => {
  assert.equal(cashMovement({ direction: "IN", amount_minor: 10000n }), 10000n);
  assert.equal(cashMovement({ direction: "IN", amount_minor: -3000n }), -3000n); // contra flows through
});

test("cashMovement: OUT subtracts signed amount", () => {
  assert.equal(cashMovement({ direction: "OUT", amount_minor: 2550n }), -2550n);
  assert.equal(cashMovement({ direction: "OUT", amount_minor: -1000n }), 1000n); // subtracting a negative
});

test("cashMovement: TRANSFER is zero (pairing verified separately)", () => {
  assert.equal(cashMovement({ direction: "TRANSFER", amount_minor: 5000n }), 0n);
});
