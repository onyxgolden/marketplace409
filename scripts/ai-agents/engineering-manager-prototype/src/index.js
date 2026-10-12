/**
 * index.js — public entry for the engineering-manager prototype.
 * Pure Node 24 ESM, zero runtime dependencies, zero model calls.
 *
 * run(task, context) -> result. The agent has no file-write API, no network,
 * no tool calls: it returns a detached advisory JSON snapshot. Advisory
 * output is never an execution token: assignment_authorized is always false
 * and restricted routing is only ever "simulated_approved".
 */

import { buildPlan, PlannerError, BUDGET_LIMITS } from "./planner.js";
import { canonicalJson, sha256HexUtf8 } from "./canonical.js";
import { validateTask } from "./schemas.js";

export const AGENT_ID = "engineering-manager";
export const SCHEMA_VERSION = "1";

function envelope(task, payload) {
  const taskId = `em-${sha256HexUtf8(canonicalJson(task)).slice(0, 16)}`;
  const refs = [];
  if (task && task.brief_ref) refs.push({ ...task.brief_ref });
  for (const r of task?.related_brief_refs ?? []) refs.push({ ...r });
  return {
    schema_version: SCHEMA_VERSION,
    agent: AGENT_ID,
    task_id: taskId,
    advisory: true,
    fixture_only: true,
    source_refs: refs,
    ...payload,
  };
}

/**
 * Run the planner. A malformed request, budget exhaustion, prohibited
 * action or unsupported task yields a structured REFUSED denial — never an
 * exception and never a default success.
 */
export function run(task, context) {
  try {
    const { payload } = buildPlan(task, context);
    return envelope(task, payload);
  } catch (e) {
    if (e instanceof PlannerError) {
      const taskId =
        task && typeof task === "object"
          ? `em-${sha256HexUtf8(canonicalJson(task)).slice(0, 16)}`
          : "em-invalid-task";
      return {
        schema_version: SCHEMA_VERSION,
        agent: AGENT_ID,
        task_id: taskId,
        advisory: true,
        fixture_only: true,
        source_refs: [],
        status: e.status,
        planning_state: "unapproved",
        approval_ref: null,
        nodes: [],
        edges: [],
        gate_status: [],
        conflicts: [],
        diagnostics: [
          {
            code: e.code,
            severity: e.code === "ACTION_DENIED" ? "critical" : "error",
            source_ref: task && task.brief_ref ? { ...task.brief_ref } : null,
            record_id: null,
            reason: e.reason,
          },
        ],
        quarantined_sources: [],
        routing_flags: [],
        complete: false,
      };
    }
    throw e;
  }
}

export { buildPlan, PlannerError, BUDGET_LIMITS, canonicalJson, sha256HexUtf8, validateTask };
