/**
 * classify.test.js — classification from recorded vitest JSON fixtures
 * is exact: PASS / FAIL / ERROR / TIMEOUT, failing-test name + file
 * extraction, and the never-PASS-on-unparseable rule.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseVitestJson, classifySuiteResult, extractFailingTests } from "../src/index.js";
import { loadFixtureJson, loadFixtureText } from "./helpers.js";

describe("vitest classification from recorded fixtures", () => {
  it("pass fixture + exit 0 classifies PASS with exact counts", () => {
    const json = parseVitestJson(loadFixtureText("vitest-pass.json"));
    assert.ok(json);
    const r = classifySuiteResult({ exitCode: 0, json });
    assert.equal(r.status, "PASS");
    assert.deepEqual(r.test_counts, { total: 2, passed: 2, failed: 0, pending: 0, skipped: 0, todo: 0 });
    assert.deepEqual(r.failing_tests, []);
    assert.equal(r.reason_code, null);
  });

  it("fail fixture + exit 1 classifies FAIL with the failing test name and file", () => {
    const json = parseVitestJson(loadFixtureText("vitest-fail.json"));
    const r = classifySuiteResult({ exitCode: 1, json });
    assert.equal(r.status, "FAIL");
    assert.deepEqual(r.test_counts, { total: 4, passed: 3, failed: 1, pending: 0, skipped: 0, todo: 0 });
    assert.deepEqual(r.failing_tests, [{ name: "beta divides numbers", file: "/fixture-checkout/src/beta.test.js" }]);
  });

  it("error fixture (suite load error, zero failing assertions) classifies ERROR, never FAIL or PASS", () => {
    const json = parseVitestJson(loadFixtureText("vitest-error.json"));
    const r = classifySuiteResult({ exitCode: 1, json });
    assert.equal(r.status, "ERROR");
    assert.equal(r.reason_code, "SUITE_LOAD_ERROR");
    assert.equal(r.test_counts.failed, 0);
    assert.equal(r.failing_tests.length, 1);
    assert.equal(r.failing_tests[0].file, "/fixture-checkout/src/broken.test.js");
    assert.match(r.failing_tests[0].name, /suite error/);
  });

  it("missing or unparseable vitest output is ERROR — never PASS, even on exit 0", () => {
    for (const json of [null, parseVitestJson("not json at all"), parseVitestJson("")]) {
      const r = classifySuiteResult({ exitCode: 0, json });
      assert.equal(r.status, "ERROR");
      assert.equal(r.reason_code, "VITEST_OUTPUT_UNPARSEABLE");
    }
  });

  it("a timed-out suite is TIMEOUT even when its partial report says pass", () => {
    const json = parseVitestJson(loadFixtureText("vitest-pass.json"));
    const r = classifySuiteResult({ exitCode: null, timedOut: true, json });
    assert.equal(r.status, "TIMEOUT");
    assert.equal(r.reason_code, "SUITE_TIMEOUT");
  });

  it("a spawn failure is ERROR/SPAWN_FAILED", () => {
    const r = classifySuiteResult({ exitCode: null, spawnError: "spawn npx ENOENT", json: null });
    assert.equal(r.status, "ERROR");
    assert.equal(r.reason_code, "SPAWN_FAILED");
  });

  it("an output-cap kill is ERROR/OUTPUT_CAP_EXCEEDED", () => {
    const r = classifySuiteResult({ exitCode: null, outputExceeded: true, json: null });
    assert.equal(r.status, "ERROR");
    assert.equal(r.reason_code, "OUTPUT_CAP_EXCEEDED");
  });

  it("exit 0 with success:false and no failed suites is ERROR, not PASS", () => {
    const json = loadFixtureJson("vitest-pass.json");
    json.success = false;
    const r = classifySuiteResult({ exitCode: 0, json });
    assert.equal(r.status, "ERROR");
  });

  it("failing tests are sorted by (file, name) regardless of emission order", () => {
    const json = {
      testResults: [
        {
          name: "/z/last.test.js",
          status: "failed",
          message: "",
          assertionResults: [{ fullName: "z b", title: "b", status: "failed", failureMessages: ["x"] }],
        },
        {
          name: "/a/first.test.js",
          status: "failed",
          message: "",
          assertionResults: [
            { fullName: "a z", title: "z", status: "failed", failureMessages: ["x"] },
            { fullName: "a a", title: "a", status: "failed", failureMessages: ["x"] },
          ],
        },
      ],
    };
    const failing = extractFailingTests(json);
    assert.deepEqual(
      failing.map((f) => `${f.file}::${f.name}`),
      ["/a/first.test.js::a a", "/a/first.test.js::a z", "/z/last.test.js::z b"]
    );
  });
});
