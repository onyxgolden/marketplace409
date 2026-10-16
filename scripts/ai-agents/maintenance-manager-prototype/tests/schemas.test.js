import { test } from "node:test";
import assert from "node:assert/strict";
import { validateIsoDate, validateWorkOrder, validatePmOccurrence, validateSourceRef, validateTask, SchemaError } from "../src/schemas.js";

function must(fn, msg) {
  assert.throws(fn, SchemaError, msg);
}

test("validateIsoDate rejects a non-existent calendar date (Feb 30)", () => {
  must(() => validateIsoDate("2026-02-30", "x"));
});

test("validateIsoDate accepts a real leap day and rejects the same date in a non-leap year", () => {
  assert.doesNotThrow(() => validateIsoDate("2028-02-29", "x"));
  must(() => validateIsoDate("2026-02-29", "x"));
});

test("validateIsoDate rejects malformed formats", () => {
  must(() => validateIsoDate("2026-2-5", "x"));
  must(() => validateIsoDate("06/01/2026", "x"));
  must(() => validateIsoDate(20260601, "x"));
});

const VALID_REF = { repo: "maint-sources", path: "content/x.txt", commit: "a".repeat(40), blob: "b".repeat(40), algorithm: "git-sha1", revision: "v1" };

test("validateSourceRef rejects uppercase path segments", () => {
  must(() => validateSourceRef({ ...VALID_REF, path: "content/UPPER.txt" }, "x"));
});

test("validateSourceRef rejects a non-full-hex commit", () => {
  must(() => validateSourceRef({ ...VALID_REF, commit: "abc" }, "x"));
});

test("validateSourceRef rejects wrong algorithm", () => {
  must(() => validateSourceRef({ ...VALID_REF, algorithm: "sha256" }, "x"));
});

const VALID_WO = { work_order_id: "WO-1", asset_id: "AST-1", created_date: "2026-05-01", status: "OPEN", priority: "P2", completed_date: null, due_date: null, notes: "", content_ref: VALID_REF, span: { start_byte: 0, end_byte: 1 } };

test("validateWorkOrder rejects an unknown status", () => {
  must(() => validateWorkOrder({ ...VALID_WO, status: "ON_HOLD" }, "x"));
});

test("validateWorkOrder rejects an unknown priority", () => {
  must(() => validateWorkOrder({ ...VALID_WO, priority: "URGENT" }, "x"));
});

test("validateWorkOrder rejects an unknown property", () => {
  must(() => validateWorkOrder({ ...VALID_WO, extra_field: 1 }, "x"));
});

test("validateWorkOrder accepts null completed_date/due_date", () => {
  const v = validateWorkOrder(VALID_WO, "x");
  assert.equal(v.completed_ms, null);
  assert.equal(v.due_ms, null);
});

test("validateWorkOrder enforces the notes byte cap", () => {
  must(() => validateWorkOrder({ ...VALID_WO, notes: "x".repeat(3000) }, "x"));
});

const VALID_OCC = { occurrence_id: "PM-1", asset_id: "AST-1", due_date: "2026-05-10", window_start: "2026-05-05", window_end: "2026-05-15", linked_work_order_id: null, content_ref: VALID_REF, span: { start_byte: 0, end_byte: 1 } };

test("validatePmOccurrence rejects window_end before window_start", () => {
  must(() => validatePmOccurrence({ ...VALID_OCC, window_start: "2026-05-15", window_end: "2026-05-05" }, "x"));
});

test("validatePmOccurrence accepts a null linked_work_order_id", () => {
  const v = validatePmOccurrence(VALID_OCC, "x");
  assert.equal(v.linked_work_order_id, null);
});

const VALID_TASK = {
  schema_version: "1",
  task_id: "t1",
  operation: "analyze",
  fixture_refs: { register: VALID_REF },
  options: { as_of_date: "2026-06-01", window: { start_date: "2026-01-01", end_date: "2026-12-31" }, population: { declared_total: 1, complete: true } },
};

test("validateTask rejects window end before start", () => {
  must(() => validateTask({ ...VALID_TASK, options: { ...VALID_TASK.options, window: { start_date: "2026-12-31", end_date: "2026-01-01" } } }));
});

test("validateTask rejects a negative declared_total", () => {
  must(() => validateTask({ ...VALID_TASK, options: { ...VALID_TASK.options, population: { declared_total: -1, complete: true } } }));
});

test("validateTask classifies a non-'analyze' operation as prohibited, not malformed", () => {
  const v = validateTask({ ...VALID_TASK, operation: "dispatch" });
  assert.equal(v.kind, "prohibited");
});

test("validateTask rejects an unknown top-level property", () => {
  must(() => validateTask({ ...VALID_TASK, extra: 1 }));
});
