import { test } from "node:test";
import assert from "node:assert/strict";
import { validateJobDefinition, BUDGET_CAPS } from "../src/jobDefinition.js";
import { validDefinition, expectCode } from "./helpers.js";

test("valid definition passes and normalizes", () => {
  const out = validateJobDefinition(validDefinition());
  assert.equal(out.job_id, "research-weekly-brief@1");
  assert.equal(out.status, "DISABLED");
  assert.equal(out.deliverable_schema_version, "workbench-item@1");
  assert.deepEqual(out.allowed_source_corpus_ids, ["generac-7209-synthetic-replay", "small-corpus", "empty-corpus"]);
});

test("unknown top-level and nested fields refuse", () => {
  expectCode(() => validateJobDefinition(validDefinition({ mode: "LIVE" })), "BAD_JOB");
  expectCode(() => validateJobDefinition(validDefinition({
    budget: { max_items_per_run: 1, max_bytes_per_run: 100, max_tool_calls_per_run: 1, adapter: "x" },
  })), "BAD_JOB");
  expectCode(() => validateJobDefinition(validDefinition({
    operator_scope: { operator_ref: "a", workspace_ref: "b", extra: 1 },
  })), "BAD_JOB");
});

test("job id shape and version binding", () => {
  expectCode(() => validateJobDefinition(validDefinition({ job_id: "weekly-brief@1" })), "BAD_JOB_ID");
  expectCode(() => validateJobDefinition(validDefinition({ job_id: "research-weekly-brief@2" })), "VERSION_MISMATCH");
  expectCode(() => validateJobDefinition(validDefinition({ version: 2 })), "VERSION_MISMATCH");
  expectCode(() => validateJobDefinition(validDefinition({ job_type: "planning" })), "BAD_JOB_TYPE");
});

test("ambiguous ownership refuses", () => {
  expectCode(() => validateJobDefinition(validDefinition({
    operator_scope: { workspace_ref: "ws-1" },
  })), "AMBIGUOUS_OWNERSHIP");
  expectCode(() => validateJobDefinition(validDefinition({
    operator_scope: { operator_ref: "", workspace_ref: "ws-1" },
  })), "AMBIGUOUS_OWNERSHIP");
  expectCode(() => validateJobDefinition(validDefinition({ decision_owner: "" })), "AMBIGUOUS_OWNERSHIP");
  const noScope = validDefinition();
  delete noScope.operator_scope;
  expectCode(() => validateJobDefinition(noScope), "BAD_JOB");
});

test("source authorization: empty, duplicate, registry", () => {
  expectCode(() => validateJobDefinition(validDefinition({ allowed_source_corpus_ids: [] })), "MISSING_SOURCE_AUTHORIZATION");
  expectCode(() => validateJobDefinition(validDefinition({ allowed_source_corpus_ids: ["a", "a"] })), "DUPLICATE_CORPUS_ID");
  expectCode(() => validateJobDefinition(validDefinition({ allowed_source_corpus_ids: ["Bad_ID"] })), "BAD_JOB");
  expectCode(
    () => validateJobDefinition(validDefinition(), { authorizedCorpusIds: ["small-corpus"] }),
    "MISSING_SOURCE_AUTHORIZATION",
  );
  assert.doesNotThrow(() => validateJobDefinition(validDefinition(), {
    authorizedCorpusIds: ["generac-7209-synthetic-replay", "small-corpus", "empty-corpus"],
  }));
});

test("exclusions: shape, duplicates, and allowed-but-excluded is valid at definition time", () => {
  expectCode(() => validateJobDefinition(validDefinition({ exclusions: "nope" })), "BAD_EXCLUSION");
  expectCode(() => validateJobDefinition(validDefinition({ exclusions: ["x", "x"] })), "BAD_EXCLUSION");
  // An exclusion naming an allowed corpus is not a contradiction: it
  // narrows the authorized set at preview time (EXCLUDED_CORPUS), so
  // the definition itself validates.
  assert.doesNotThrow(() => validateJobDefinition(validDefinition({ exclusions: ["small-corpus"] })));
  assert.doesNotThrow(() => validateJobDefinition(validDefinition({ exclusions: ["other-corpus"] })));
});

test("deliverable version, budgets, status", () => {
  expectCode(() => validateJobDefinition(validDefinition({ deliverable_schema_version: "workbench-item@2" })), "UNSUPPORTED_DELIVERABLE_VERSION");
  expectCode(() => validateJobDefinition(validDefinition({
    budget: { max_items_per_run: BUDGET_CAPS.max_items_per_run + 1, max_bytes_per_run: 100, max_tool_calls_per_run: 1 },
  })), "EXCESSIVE_BUDGET");
  expectCode(() => validateJobDefinition(validDefinition({
    budget: { max_items_per_run: 1, max_bytes_per_run: BUDGET_CAPS.max_bytes_per_run + 1, max_tool_calls_per_run: 1 },
  })), "EXCESSIVE_BUDGET");
  expectCode(() => validateJobDefinition(validDefinition({
    budget: { max_items_per_run: 1, max_bytes_per_run: 100, max_tool_calls_per_run: BUDGET_CAPS.max_tool_calls_per_run + 1 },
  })), "EXCESSIVE_BUDGET");
  expectCode(() => validateJobDefinition(validDefinition({
    budget: { max_items_per_run: 0, max_bytes_per_run: 100, max_tool_calls_per_run: 1 },
  })), "BAD_JOB");
  expectCode(() => validateJobDefinition(validDefinition({
    budget: { max_items_per_run: 1.5, max_bytes_per_run: 100, max_tool_calls_per_run: 1 },
  })), "BAD_JOB");
  expectCode(() => validateJobDefinition(validDefinition({ status: "LIVE" })), "NON_DISABLED_STATUS");
  expectCode(() => validateJobDefinition(validDefinition({ status: "SYNTHETIC_PREVIEW" })), "NON_DISABLED_STATUS");
});

test("provenance rules", () => {
  expectCode(() => validateJobDefinition(validDefinition({
    provenance: { created_by: "op-1", created_at: "2026-11-04 15:00:00" },
  })), "BAD_JOB");
  expectCode(() => validateJobDefinition(validDefinition({
    provenance: { created_by: "op-1", created_at: "2026-11-04T15:00:00Z", updated_at: "2026-11-05T15:00:00Z" },
  })), "BAD_PROVENANCE");
  expectCode(() => validateJobDefinition(validDefinition({
    provenance: { created_by: "op-1", created_at: "2026-11-05T15:00:00Z", updated_by: "op-1", updated_at: "2026-11-04T15:00:00Z" },
  })), "BAD_PROVENANCE");
  assert.doesNotThrow(() => validateJobDefinition(validDefinition({
    provenance: { created_by: "op-1", created_at: "2026-11-04T15:00:00Z", updated_by: "op-2", updated_at: "2026-11-05T15:00:00Z" },
  })));
});

test("Proxy and accessor inputs refuse with zero trap/getter invocations", () => {
  let traps = 0;
  const counting = new Proxy({ a: 1 }, {
    get(t, p, r) { traps++; return Reflect.get(t, p, r); },
    getOwnPropertyDescriptor(t, p) { traps++; return Reflect.getOwnPropertyDescriptor(t, p); },
    ownKeys(t) { traps++; return Reflect.ownKeys(t); },
  });
  const def = validDefinition();
  def.operator_scope = counting;
  expectCode(() => validateJobDefinition(def), "BAD_JOB");
  assert.equal(traps, 0);

  let getterCalls = 0;
  const withGetter = validDefinition();
  Object.defineProperty(withGetter, "title", {
    enumerable: true,
    get() { getterCalls++; return "x"; },
  });
  expectCode(() => validateJobDefinition(withGetter), "BAD_JOB");
  assert.equal(getterCalls, 0);
});
