/**
 * fix-round3b.test.js — round 3, part 2: Q665-004A (dangerous-key
 * policy), Q665-004B (exact incremental UTF-8 byte charging),
 * Q665-005A (central final-envelope bound).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  admitValue,
  ADMISSION_LIMITS,
  validateJob,
  runJob,
  canonicalJson,
  enforceReportBytes,
  minimalEnvelope,
  reportBytes,
  completedReport,
  refusalReport,
  MIN_REPORT_BYTES,
} from "../src/index.js";

const CLI = fileURLToPath(new URL("../runner/run-job.mjs", import.meta.url));

function runCli(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { encoding: "utf8" }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr });
    });
  });
}

function writeJobFile(t, text) {
  const dir = mkdtempSync(join(tmpdir(), "qa-r3b-job-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const p = join(dir, "job.json");
  writeFileSync(p, text);
  return p;
}

const bytesOf = (v) => Buffer.byteLength(JSON.stringify(v), "utf8");

/* ------------------------------------------------------------------ */
/* Q665-004A — __proto__-as-own-key prototype control                   */
/* ------------------------------------------------------------------ */

describe("Q665-004A: dangerous-key policy — __proto__ never confers inherited config", () => {
  it("ChatGPT's verbatim vector: own __proto__ carrying target/head_pin/suites is refused DANGEROUS_KEY", () => {
    const parsed = JSON.parse(`{"__proto__":{"target":"/none","head_pin":"${"a".repeat(40)}","suites":[]}}`);
    assert.ok(Object.prototype.hasOwnProperty.call(parsed, "__proto__"), "precondition: own __proto__ data key");
    const r = admitValue(parsed);
    assert.equal(r.ok, false);
    assert.equal(r.code, "DANGEROUS_KEY");
  });

  it("a nested __proto__ is refused (not just top-level)", () => {
    const r = admitValue({ a: { b: JSON.parse('{"__proto__":{"x":1}}') } });
    assert.equal(r.ok, false);
    assert.equal(r.code, "DANGEROUS_KEY");
  });

  it("a __proto__ early in a large object is refused on the key, not on the budget", () => {
    const input = JSON.parse(`{"__proto__":{"polluted":true},"pad":"${"x".repeat(8000)}"}`);
    assert.ok(Object.prototype.hasOwnProperty.call(input, "__proto__"), "precondition: own __proto__ key");
    const r = admitValue(input);
    assert.equal(r.ok, false);
    assert.equal(r.code, "DANGEROUS_KEY");
  });

  it("constructor/prototype keys stay inert own data (documented policy: only __proto__ confers inheritance)", () => {
    const r = admitValue(JSON.parse('{"constructor":{"x":1},"prototype":{"y":2},"ok":true}'));
    assert.equal(r.ok, true);
    assert.equal(r.value.constructor.x, 1, "own data, not the constructor");
    assert.equal(Object.getPrototypeOf(r.value), Object.prototype, "prototype untouched");
  });

  it("validateJob surfaces DANGEROUS_KEY for a __proto__-bearing job (never an admitted job)", () => {
    const raw = JSON.parse(
      `{"__proto__":{"target":"/none","head_pin":"${"a".repeat(40)}","suites":[]},"target":"/real","head_pin":"${"b".repeat(40)}","suites":[]}`
    );
    const v = validateJob(raw);
    assert.equal(v.ok, false);
    assert.equal(v.errors[0].code, "DANGEROUS_KEY");
    assert.equal(v.job, null, "no detached copy escapes a dangerous-key refusal");
  });
});

/* ------------------------------------------------------------------ */
/* Q665-004B — exact incremental serialized-JSON UTF-8 byte charging    */
/* ------------------------------------------------------------------ */

describe("Q665-004B: exact incremental UTF-8 byte charging", () => {
  // 8 strings of 8000 "x" + 1 string of 1499 "x": serialization is
  // exactly 65,536 UTF-8 bytes. The +1 variant uses 1500 for the last
  // string -> 65,537 bytes.
  function sizedInput(lastLen) {
    const pads = Array.from({ length: 8 }, () => "x".repeat(8000));
    pads.push("x".repeat(lastLen));
    return { pads };
  }

  it("API exact-fit: a 65,536-byte serialization admits", () => {
    const input = sizedInput(1499);
    assert.equal(bytesOf(input), 65536, "precondition: exactly at the budget");
    assert.equal(admitValue(input).ok, true);
  });

  it("API +1: a 65,537-byte serialization refuses INPUT_LIMIT", () => {
    const input = sizedInput(1500);
    assert.equal(bytesOf(input), 65537, "precondition: one byte over");
    const r = admitValue(input);
    assert.equal(r.ok, false);
    assert.equal(r.code, "INPUT_LIMIT");
  });

  it("multibyte-exact: a char-count estimate would admit, exact UTF-8 refuses", () => {
    // 3 strings of 7282 snowmen: 21,865 CHARS (old length+2 estimate
    // admits) but 65,557 UTF-8 BYTES (exact refuses).
    const input = { pads: ["\u96EA".repeat(7282), "\u96EA".repeat(7282), "\u96EA".repeat(7282)] };
    const chars = JSON.stringify(input).length;
    assert.ok(chars <= 65536, `precondition: char estimate admits (${chars})`);
    assert.ok(bytesOf(input) > 65536, `precondition: byte-exact refuses (${bytesOf(input)})`);
    const r = admitValue(input);
    assert.equal(r.ok, false);
    assert.equal(r.code, "INPUT_LIMIT");
  });

  it("escaping/numeric/punctuation-exact: quotes, backslashes and numeric spellings charge exactly", () => {
    const tricky = 'a"b\\c\x01\x7f\u96EA';
    // 8 base strings of 8000 chars (<= maxStringLength) plus a solved
    // final string: each "x" is exactly 1 byte, so the fit is linear.
    const mk = (lastLen) => ({
      s: tricky,
      n: 1e21,
      m: -0.5,
      arr: [true, null, 1.5],
      pads: [...Array.from({ length: 8 }, () => "x".repeat(8000)), "x".repeat(lastLen)],
    });
    const b0 = bytesOf(mk(100));
    const lastLen = 100 + (65536 - b0);
    assert.ok(lastLen > 0 && lastLen <= 8192, `precondition: solvable within string limits (${lastLen})`);
    const input = mk(lastLen);
    assert.equal(bytesOf(input), 65536, "precondition: exact fit with escaping/numerics present");
    assert.equal(admitValue(input).ok, true);
    const over = mk(lastLen + 1);
    assert.equal(bytesOf(over), 65537);
    const r = admitValue(over);
    assert.equal(r.ok, false);
    assert.equal(r.code, "INPUT_LIMIT");
  });

  it("charge-before-visit: an over-budget MALFORMED tail dies on INPUT_LIMIT, never on validation", () => {
    const big = "x".repeat(8000);
    const job = {
      target: "/t",
      head_pin: "a".repeat(40),
      suites: [
        { id: "ok", patterns: ["a"] },
        // Past the byte budget AND malformed (timeout_ms not a number):
        // the budget charge must fire before validation ever reads it.
        { id: "tail", patterns: Array.from({ length: 9 }, () => big), timeout_ms: "not-a-number" },
      ],
    };
    assert.ok(bytesOf(job) > 65536, "precondition: over budget");
    const v = validateJob(job);
    assert.equal(v.ok, false);
    assert.equal(v.errors[0].code, "INPUT_LIMIT", "budget refusal, not a validation code");
  });

  it("CLI exact-fit/+1: a 65,536-byte file is admitted (refused on merits), 65,537 refused INPUT_LIMIT", async (t) => {
    const job = { target: join(tmpdir(), "qa-r3b-no-such-checkout"), head_pin: "a".repeat(40), suites: [{ id: "s", patterns: ["x"] }] };
    const text = JSON.stringify(job);
    const exact = text + " ".repeat(65536 - text.length);
    assert.equal(Buffer.byteLength(exact), 65536);
    const p1 = writeJobFile(t, exact);
    const r1 = await runCli([p1]);
    const parsed1 = JSON.parse(r1.stdout);
    assert.equal(parsed1.reason_code, "TARGET_NOT_FOUND", "admitted, then refused on its merits — not INPUT_LIMIT");

    const over = text + " ".repeat(65537 - text.length);
    assert.equal(Buffer.byteLength(over), 65537);
    const p2 = writeJobFile(t, over);
    const r2 = await runCli([p2]);
    const parsed2 = JSON.parse(r2.stdout);
    assert.equal(parsed2.reason_code, "INPUT_LIMIT");
  });
});

/* ------------------------------------------------------------------ */
/* Q665-005A — central final-envelope bound                             */
/* ------------------------------------------------------------------ */

describe("Q665-005A: final-envelope bounds enforced centrally for every API outcome", () => {
  it("the minimal envelope fits inside the admission floor (out-of-band contract)", () => {
    const m = minimalEnvelope({ status: "REFUSED", verdict: "REFUSED", reason_code: "ISOLATION_UNAVAILABLE" });
    const b = reportBytes(m);
    assert.ok(b <= MIN_REPORT_BYTES, `minimal envelope is ${b} bytes, floor is ${MIN_REPORT_BYTES}`);
  });

  it("exact: a report at exactly max_report_bytes passes through byte-identical", () => {
    const big = completedReport(
      { job_id: "exact", target: "/t", head_pin: "a".repeat(40) },
      "a".repeat(40),
      [{
        id: "s", patterns: ["x"], timeout_ms: 1000, status: "FAIL", exit_code: 1, signal: null,
        reason_code: null, reason: "failing ".repeat(200),
        test_counts: { total: 10, passed: 9, failed: 1, pending: 0, skipped: 0, todo: 0 },
        failing_tests: [{ name: "n".repeat(300), file: "/f.test.js" }],
        failing_tests_total: 1, failing_tests_truncated: false, cleanup_failed: false,
      }],
      { mechanism: "bwrap", network: "denied", environment: "scrubbed", execution_tree: "copy", original_checkout: "untouched" }
    );
    const B = reportBytes(big);
    assert.ok(B > MIN_REPORT_BYTES, `precondition: report is ${B} bytes, above the floor`);
    const { report: same, truncated } = enforceReportBytes(big, B);
    assert.equal(truncated, false);
    assert.equal(canonicalJson(same), canonicalJson(big), "exact-fit passes through untouched");
  });

  it("+1: one byte over the cap truncates with the outcome preserved and truncation explicit", () => {
    const big = completedReport(
      { job_id: "plusone", target: "/t", head_pin: "a".repeat(40) },
      "a".repeat(40),
      [{
        id: "s", patterns: ["x".repeat(50)], timeout_ms: 1000, status: "FAIL", exit_code: 1, signal: null,
        reason_code: null, reason: "failing ".repeat(200),
        test_counts: { total: 10, passed: 9, failed: 1, pending: 0, skipped: 0, todo: 0 },
        failing_tests: [{ name: "n".repeat(300), file: "/f.test.js" }],
        failing_tests_total: 1, failing_tests_truncated: false, cleanup_failed: false,
      }],
      null
    );
    const B = reportBytes(big);
    const { report: shrunk, truncated } = enforceReportBytes(big, B - 1);
    assert.equal(truncated, true);
    assert.ok(reportBytes(shrunk) <= B - 1, "bounded report fits the cap");
    assert.equal(shrunk.status, big.status, "outcome status preserved");
    assert.equal(shrunk.verdict, big.verdict, "verdict preserved");
    assert.equal(shrunk.diagnostics[0].code, "REPORT_TRUNCATED", "truncation is explicit");
  });

  it("long refusals are bounded too: a capped refusal keeps its reason and fits", () => {
    const r = refusalReport(
      { job_id: "j", target: "/t", head_pin: "a".repeat(40), suites: [{ id: "s", patterns: ["x"] }] },
      "TARGET_NOT_CLEAN",
      [{ code: "TARGET_NOT_CLEAN", path: "$.target", message: "dirty: " + "M file\n".repeat(500) }]
    );
    const B = reportBytes(r);
    assert.ok(B > 2048, `precondition: refusal is ${B} bytes`);
    const { report: bounded } = enforceReportBytes(r, 2048);
    assert.ok(reportBytes(bounded) <= 2048);
    assert.equal(bounded.reason_code, "TARGET_NOT_CLEAN", "refusal reason preserved");
    assert.equal(bounded.status, "REFUSED");
  });

  it("a cap below the floor is refused at admission (INVALID_BUDGET) — the meaningful-minimum contract", () => {
    const v = validateJob({
      target: "/t",
      head_pin: "a".repeat(40),
      suites: [{ id: "s", patterns: ["x"] }],
      budgets: { max_report_bytes: MIN_REPORT_BYTES - 1 },
    });
    assert.equal(v.ok, false);
    assert.equal(v.errors[0].code, "INVALID_BUDGET");
    assert.match(v.errors[0].message, new RegExp(String(MIN_REPORT_BYTES)));
  });

  it("API end-to-end: an admitted cap smaller than the natural report is honored with the outcome intact", async () => {
    const suites = Array.from({ length: 8 }, (_, i) => ({
      id: `suite-${i}-` + "s".repeat(100),
      patterns: Array.from({ length: 16 }, (_, j) => `tests/p${j}-` + "x".repeat(200)),
    }));
    const job = (cap) => ({
      target: join(tmpdir(), "qa-r3b-no-such-checkout"),
      head_pin: "a".repeat(40),
      suites,
      ...(cap === undefined ? {} : { budgets: { max_report_bytes: cap } }),
    });
    const natural = await runJob(job(), { isolation: null });
    const B = reportBytes(natural);
    assert.ok(B > MIN_REPORT_BYTES, `precondition: natural report is ${B} bytes`);
    const capped = await runJob(job(B - 1), { isolation: null });
    assert.ok(reportBytes(capped) <= B - 1, "admitted cap honored on the API path");
    assert.equal(capped.status, natural.status);
    assert.equal(capped.reason_code, natural.reason_code);
    assert.equal(capped.diagnostics[0].code, "REPORT_TRUNCATED");
  });
});
