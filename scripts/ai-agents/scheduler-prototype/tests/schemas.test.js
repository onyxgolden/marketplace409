/** schemas.test.js — record and task validation. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateNetworkRecord, validateTask, splitTopLevelArray, SchemaError,
} from "../src/schemas.js";

function activity(over = {}) {
  return { record: "activity", id: "A", component: "c1", duration_workdays: 3, release_tick: 0, ...over };
}

test("valid activity passes", () => {
  const r = validateNetworkRecord(activity(), "t");
  assert.equal(r.id, "A");
  assert.equal(r.note, "");
});

test("tie types and signed lag", () => {
  for (const type of ["FS", "SS", "FF", "SF"]) {
    const r = validateNetworkRecord({ record: "tie", id: "t1", component: "c1", predecessor: "A", successor: "B", type, lag_workdays: -5 }, "t");
    assert.equal(r.type, type);
  }
  assert.throws(() => validateNetworkRecord({ record: "tie", id: "t1", component: "c1", predecessor: "A", successor: "B", type: "XX", lag_workdays: 0 }, "t"), SchemaError);
});

test("self-tie rejected", () => {
  assert.throws(() => validateNetworkRecord({ record: "tie", id: "t1", component: "c1", predecessor: "A", successor: "A", type: "FS", lag_workdays: 0 }, "t"), /must differ/);
});

test("negative duration and oversize ticks rejected", () => {
  assert.throws(() => validateNetworkRecord(activity({ duration_workdays: -1 }), "t"), SchemaError);
  assert.throws(() => validateNetworkRecord(activity({ duration_workdays: 367 }), "t"), SchemaError);
  assert.throws(() => validateNetworkRecord(activity({ release_tick: 367 }), "t"), SchemaError);
});

test("calendar weekday rules", () => {
  const good = { record: "calendar", component: "c1", working_weekdays: [1, 2, 3, 4, 5], excluded_dates: [] };
  assert.deepEqual(validateNetworkRecord(good, "t").working_weekdays, [1, 2, 3, 4, 5]);
  assert.throws(() => validateNetworkRecord({ ...good, working_weekdays: [] }, "t"), SchemaError);
  assert.throws(() => validateNetworkRecord({ ...good, working_weekdays: [1, 1] }, "t"), SchemaError);
  assert.throws(() => validateNetworkRecord({ ...good, working_weekdays: [8] }, "t"), SchemaError);
  assert.throws(() => validateNetworkRecord({ ...good, excluded_dates: ["2026-02-30"] }, "t"), SchemaError);
});

test("unknown record kind rejected", () => {
  assert.throws(() => validateNetworkRecord({ record: "milestone", id: "A", component: "c1" }, "t"), SchemaError);
});

test("unknown properties rejected", () => {
  assert.throws(() => validateNetworkRecord({ ...activity(), bogus: 1 }, "t"), /unknown property/);
});

test("splitTopLevelArray yields raw spans without decoding", () => {
  const spans = splitTopLevelArray(`[ {"a": 1}, {"b": "x}"} ]`, "t");
  assert.equal(spans.length, 2);
  assert.equal(spans[0].text, `{"a": 1}`);
  assert.equal(spans[1].text, `{"b": "x}"}`);
  // Byte offsets are half-open UTF-8 ranges into the source text.
  const src = `[ {"a": 1}, {"b": "x}"} ]`;
  const buf = Buffer.from(src, "utf8");
  assert.equal(buf.subarray(spans[0].startByte, spans[0].endByte).toString("utf8"), spans[0].text);
  assert.equal(buf.subarray(spans[1].startByte, spans[1].endByte).toString("utf8"), spans[1].text);
});

test("splitTopLevelArray byte offsets count UTF-8 bytes, not chars", () => {
  // "é" is 2 bytes in UTF-8; a char-index offset would be wrong.
  const src = `[{"n":"é"},{"n":"x"}]`;
  const spans = splitTopLevelArray(src, "t");
  assert.equal(spans.length, 2);
  const buf = Buffer.from(src, "utf8");
  assert.equal(buf.subarray(spans[0].startByte, spans[0].endByte).toString("utf8"), `{"n":"é"}`);
  assert.equal(buf.subarray(spans[1].startByte, spans[1].endByte).toString("utf8"), `{"n":"x"}`);
  assert.equal(spans[1].startByte - spans[0].endByte, 1); // the comma
});

test("splitTopLevelArray rejects malformed structure", () => {
  assert.throws(() => splitTopLevelArray(`{"a":1}`, "t"), SchemaError);
  assert.throws(() => splitTopLevelArray(`[1,]`, "t"), SchemaError);
  assert.throws(() => splitTopLevelArray(`[1] trailing`, "t"), SchemaError);
  assert.deepEqual(splitTopLevelArray(`[]`, "t"), []);
});

test("validateTask rejects bad anchors and horizons", () => {
  const base = {
    schema_version: "1", task_id: "t", operation: "analyze",
    fixture_refs: { network_bundle: { repo: "sched-sources", path: "networks/fs-chain.json", commit: "a".repeat(40), blob: "b".repeat(40), algorithm: "git-sha1", revision: "v1" } },
    options: {
      population: { declared_total: 0, complete: true },
      anchors: { c1: "2026-01-05" }, horizon_days: 60, deadlines: {}, constraints: [], claimed: {},
    },
  };
  assert.doesNotThrow(() => validateTask(base));
  assert.throws(() => validateTask({ ...base, options: { ...base.options, horizon_days: 0 } }), SchemaError);
  assert.throws(() => validateTask({ ...base, options: { ...base.options, anchors: {} } }), SchemaError);
  assert.throws(() => validateTask({ ...base, options: { ...base.options, anchors: { c1: "2026-02-30" } } }), SchemaError);
  assert.throws(() => validateTask({ ...base, operation: "x", extra: 1 }), /unknown property/);
});
