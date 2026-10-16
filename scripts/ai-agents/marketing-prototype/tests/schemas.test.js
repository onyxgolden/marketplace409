/**
 * schemas.test.js — runtime schema unit tests: closed control objects,
 * pins, ids, timestamps, row shapes.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateTask,
  validateSourceRef,
  validateEventRow,
  validateHeaderClaimRow,
  parseTimestamp,
} from "../src/schemas.js";

const GOOD_REF = (fixture_id, kind) => ({ fixture_id, kind });
function goodTask(over = {}) {
  return {
    schema_version: "1",
    task_id: "t-1",
    operation: "analyze",
    fixture_refs: [GOOD_REF("campaigns-01", "campaigns")],
    options: {
      period: { start: "2026-10-01T00:00:00Z", end: "2026-10-08T00:00:00Z" },
      mode: "event_rows",
    },
    ...over,
  };
}

describe("validateTask", () => {
  it("accepts a minimal valid task", () => {
    assert.equal(validateTask(goodTask()).ok, true);
  });
  it("rejects unknown properties", () => {
    const v = validateTask(goodTask({ approved_by: "Jason" }));
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => e.includes("unknown property")));
  });
  it("rejects missing required fields", () => {
    const t = goodTask();
    delete t.options;
    assert.equal(validateTask(t).ok, false);
  });
  it("rejects bad schema_version, bad mode, bad period", () => {
    assert.equal(validateTask(goodTask({ schema_version: "2" })).ok, false);
    assert.equal(validateTask(goodTask({ options: { period: { start: "2026-10-01T00:00:00Z", end: "2026-10-08T00:00:00Z" }, mode: "vibes" } })).ok, false);
    const t = goodTask();
    t.options.period = { start: "2026-10-08T00:00:00Z", end: "2026-10-01T00:00:00Z" };
    assert.equal(validateTask(t).ok, false);
  });
  it("rejects duplicate fixture ids and multi-group pool members", () => {
    const t = goodTask();
    t.fixture_refs = [GOOD_REF("a", "campaigns"), GOOD_REF("a", "campaigns")];
    assert.equal(validateTask(t).ok, false);
    const t2 = goodTask();
    t2.options.pool_groups = [["a", "b"], ["b", "c"]];
    assert.equal(validateTask(t2).ok, false);
  });
  it("rejects non-objects", () => {
    assert.equal(validateTask(null).ok, false);
    assert.equal(validateTask("task").ok, false);
    assert.equal(validateTask([]).ok, false);
  });
});

describe("validateSourceRef", () => {
  const good = () => ({
    repo: "forge-fixtures",
    path: "marketing/campaigns-01.json",
    commit: "a".repeat(40),
    blob: "b".repeat(40),
    algorithm: "git-sha1",
    revision: "v1",
  });
  it("accepts a well-formed pin", () => {
    assert.equal(validateSourceRef(good()).ok, true);
  });
  it("rejects traversal, absolute and backslash paths", () => {
    for (const path of ["../x.json", "/abs/x.json", "a\\b.json", "a/../b.json"]) {
      const r = good();
      r.path = path;
      assert.equal(validateSourceRef(r).ok, false, path);
    }
  });
  it("rejects malformed hex and wrong algorithm", () => {
    const r = good();
    r.blob = "xyz";
    assert.equal(validateSourceRef(r).ok, false);
    const r2 = good();
    r2.algorithm = "sha256";
    assert.equal(validateSourceRef(r2).ok, false);
  });
});

describe("parseTimestamp", () => {
  it("accepts finite UTC instants with Z", () => {
    assert.ok(parseTimestamp("2026-10-02T12:00:00Z") !== null);
    assert.ok(parseTimestamp("2026-10-02T12:00:00.123Z") !== null);
  });
  it("rejects malformed or impossible instants", () => {
    assert.equal(parseTimestamp("2026-10-02"), null);
    assert.equal(parseTimestamp("2026-13-02T12:00:00Z"), null);
    assert.equal(parseTimestamp("2026-10-02T25:00:00Z"), null);
    assert.equal(parseTimestamp("not-a-date"), null);
    assert.equal(parseTimestamp(123), null);
  });
});

describe("row validators", () => {
  it("event rows require amount_minor for money kinds", () => {
    const base = { event_id: "e1", campaign_id: "c", timestamp: "2026-10-02T12:00:00Z" };
    assert.equal(validateEventRow({ ...base, kind: "SPEND" }, 0).ok, false);
    assert.equal(validateEventRow({ ...base, kind: "SPEND", amount_minor: 10 }, 0).ok, true);
    assert.equal(validateEventRow({ ...base, kind: "IMPRESSION" }, 0).ok, true);
    assert.equal(validateEventRow({ ...base, kind: "NOPE" }, 0).ok, false);
  });
  it("header claims validate evidence spans", () => {
    const base = { claim_id: "cl", campaign_id: "c", metric: "CTR", claimed_value: "5.00%" };
    assert.equal(validateHeaderClaimRow(base, 0).ok, true);
    assert.equal(validateHeaderClaimRow({ ...base, evidence_spans: [{ start_byte: 5, end_byte: 2, quoted_text: "x" }] }, 0).ok, false);
    assert.equal(validateHeaderClaimRow({ ...base, metric: "NOPE" }, 0).ok, false);
  });
});
