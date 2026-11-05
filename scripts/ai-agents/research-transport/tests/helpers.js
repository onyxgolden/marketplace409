import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const P1A_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "research-job-contract");

export function loadFixture(name) {
  return JSON.parse(readFileSync(join(P1A_ROOT, "fixtures", name), "utf8"));
}

/** A valid JobDefinitionV1; overrides replace whole top-level fields. */
export function validDefinition(overrides = {}) {
  return {
    job_id: "research-weekly-brief@1",
    job_type: "research",
    version: 1,
    operator_scope: { operator_ref: "op-1", workspace_ref: "ws-1" },
    decision_owner: "owner-1",
    title: "Weekly research brief",
    question: "What changed this week in the synthetic corpus?",
    allowed_source_corpus_ids: ["generac-7209-synthetic-replay", "small-corpus", "empty-corpus"],
    exclusions: [],
    deliverable_schema_version: "workbench-item@1",
    recurrence: { timezone: "America/Chicago", rule: { kind: "weekly", weekdays: [1], time: "09:00" } },
    budget: { max_items_per_run: 64, max_bytes_per_run: 262144, max_tool_calls_per_run: 64 },
    status: "DISABLED",
    provenance: { created_by: "op-1", created_at: "2026-11-04T15:00:00Z" },
    ...overrides,
  };
}

export const PRINCIPAL = Object.freeze({ operator_ref: "op-1", workspace_ref: "ws-1" });
export const NOW = "2026-11-04T15:00:00Z";

/** Assert fn (sync) or awaited promise throws an error with the expected code. */
export async function expectCode(fn, code) {
  let thrown = null;
  try {
    await fn();
  } catch (e) {
    thrown = e;
  }
  if (!thrown) throw new Error(`expected refusal ${code}, nothing thrown`);
  if (thrown.code !== code) {
    throw new Error(`expected refusal ${code}, got ${thrown.name}:${thrown.code ?? thrown.message}`);
  }
  return thrown;
}
