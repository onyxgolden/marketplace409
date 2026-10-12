/**
 * planner.js — deterministic bounded structured-brief-to-DAG planner.
 *
 * Pure function of (task, context). No I/O, no network, no tool calls.
 * Builds a DAG of plan nodes from a pinned fixture brief:
 *   - stable node IDs: SHA-256 of canonical {brief:{repo,path,blob},objective_id,local_key}
 *   - dependencies resolved from local_keys; dangling keys block the node
 *   - cycles (incl. self-loops) block the whole DAG as invalid
 *   - duplicate local keys are rejected with a diagnostic (first wins)
 *   - invalid owners / empty acceptance gates block their nodes
 *   - external gates are explicit unresolved records — never executable,
 *     never auto-cleared
 *   - prohibited actions (run_migration/deploy/execute_script) refuse the
 *     whole plan with ACTION_DENIED and produce no operational artifact
 *   - restricted scopes/actions need a valid Jason-origin approval from the
 *     separately injected store, or affected nodes stay blocked
 *   - topological order is stable with task_id tie-break, so permutations of
 *     independent declarations yield the same DAG
 *
 * Budgets (per the common contract): 256 KiB total input UTF-8, 64 resolved
 * objects, 512 evidence spans, 256 output records, 256 KiB output.
 * Exceeding a budget throws PlannerError — never a partial success.
 */

import { canonicalJson, stableNodeId, sha256HexUtf8 } from "./canonical.js";
import {
  validateTask,
  validateBrief,
  validateClock,
  RESTRICTED_SCOPES,
  RESTRICTED_ACTIONS,
  PROHIBITED_ACTIONS,
} from "./schemas.js";
import { scanSpec } from "./injection.js";
import { resolveApproval } from "./approvals.js";

export const BUDGET_LIMITS = Object.freeze({
  maxInputBytes: 256 * 1024,
  maxObjects: 64,
  maxSpans: 512,
  maxOutputRecords: 256,
  maxOutputBytes: 256 * 1024,
  maxIterations: 1_000_000,
});

export class PlannerError extends Error {
  constructor(code, reason, status = "REFUSED") {
    super(`${code}: ${reason}`);
    this.name = "PlannerError";
    this.code = code;
    this.reason = reason;
    this.status = status;
  }
}

function byteLen(s) {
  return Buffer.byteLength(s, "utf8");
}

function briefKey(ref) {
  return `${ref.repo}\0${ref.path}\0${ref.commit}`;
}

function placeholderNode(ref, objectiveId, codes) {
  return {
    task_id: stableNodeId(ref.repo, ref.path, ref.blob, objectiveId, "__missing_source__"),
    local_key: "__missing_source__",
    title: "Unresolved brief source",
    owner_proposal: "",
    assignment_authorized: false,
    dependencies: [],
    acceptance_checks: [],
    external_gates: [],
    evidence: [],
    uncertainty_flags: [],
    state: "BLOCKED",
    blocking_codes: codes,
    routing_clearance: "unapproved",
  };
}

/** Iterative cycle detection. Returns true when the graph has a cycle. */
function hasCycle(nodeIds, edges) {
  const adj = new Map();
  for (const id of nodeIds) adj.set(id, []);
  for (const e of edges) adj.get(e.from).push(e.to);
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map(nodeIds.map((id) => [id, WHITE]));
  let iterations = 0;
  for (const start of nodeIds) {
    if (color.get(start) !== WHITE) continue;
    const stack = [[start, 0]];
    color.set(start, GRAY);
    while (stack.length > 0) {
      if (++iterations > BUDGET_LIMITS.maxIterations) {
        throw new PlannerError("BUDGET_EXCEEDED", "cycle detection exceeded iteration budget");
      }
      const [u, idx] = stack[stack.length - 1];
      const nbrs = adj.get(u);
      if (idx < nbrs.length) {
        stack[stack.length - 1][1] = idx + 1;
        const v = nbrs[idx];
        const c = color.get(v);
        if (c === GRAY) return true;
        if (c === WHITE) {
          color.set(v, GRAY);
          stack.push([v, 0]);
        }
      } else {
        color.set(u, BLACK);
        stack.pop();
      }
    }
  }
  return false;
}

/**
 * Stable topological order (Kahn's algorithm) with task_id lexicographic
 * tie-break. Deterministic for a given node/edge set regardless of input
 * declaration order.
 */
function topoSort(nodeIds, edges) {
  const indeg = new Map(nodeIds.map((id) => [id, 0]));
  const adj = new Map(nodeIds.map((id) => [id, []]));
  for (const e of edges) {
    adj.get(e.from).push(e.to);
    indeg.set(e.to, indeg.get(e.to) + 1);
  }
  const zero = nodeIds.filter((id) => indeg.get(id) === 0).sort();
  const order = [];
  let iterations = 0;
  while (zero.length > 0) {
    if (++iterations > BUDGET_LIMITS.maxIterations) {
      throw new PlannerError("BUDGET_EXCEEDED", "topological sort exceeded iteration budget");
    }
    const u = zero.shift();
    order.push(u);
    for (const v of adj.get(u)) {
      indeg.set(v, indeg.get(v) - 1);
      if (indeg.get(v) === 0) {
        // insert keeping sorted order (binary insertion)
        let lo = 0;
        let hi = zero.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (zero[mid] < v) lo = mid + 1;
          else hi = mid;
        }
        zero.splice(lo, 0, v);
      }
    }
  }
  return order;
}

function isRestrictedScope(scopeId) {
  return RESTRICTED_SCOPES.includes(scopeId);
}
function isRestrictedAction(actionId) {
  return RESTRICTED_ACTIONS.includes(actionId);
}
function isProhibitedAction(actionId) {
  return PROHIBITED_ACTIONS.includes(actionId);
}

/**
 * Build the plan. Returns the planning payload (without the common envelope).
 * Throws PlannerError for malformed input, budget exhaustion, or prohibited
 * actions. Never returns a partial success.
 */
export function buildPlan(task, context) {
  const diagnostics = [];
  const quarantinedSources = [];
  const routingFlags = [];
  const diag = (code, severity, reason, sourceRef = null) => {
    diagnostics.push({ code, severity, source_ref: sourceRef, record_id: null, reason });
  };

  // ---- task schema -------------------------------------------------
  const taskErr = validateTask(task);
  if (taskErr) throw new PlannerError("INVALID_INPUT", taskErr);
  if (task.requested_action !== "plan") {
    throw new PlannerError("UNSUPPORTED_TASK", `requested_action "${task.requested_action}" is not supported; this prototype only plans`);
  }
  const clockErr = validateClock(context?.clock);
  if (clockErr) throw new PlannerError("INVALID_INPUT", `context.clock invalid: ${clockErr}`);
  const clockMs = Date.parse(context.clock);
  if (!Number.isFinite(clockMs)) throw new PlannerError("INVALID_INPUT", "context.clock is not finite");

  let objectsResolved = 0;
  const countObject = () => {
    objectsResolved += 1;
    if (objectsResolved > BUDGET_LIMITS.maxObjects) {
      throw new PlannerError("BUDGET_EXCEEDED", `object resolution budget exceeded (${BUDGET_LIMITS.maxObjects})`);
    }
  };

  const briefs = context?.briefs && typeof context.briefs === "object" ? context.briefs : {};
  const owners = Array.isArray(context?.owners) ? context.owners : [];
  const approvals = Array.isArray(context?.approvals) ? context.approvals : [];

  // ---- resolve the brief -------------------------------------------
  const ref = task.brief_ref;
  const entry = briefs[briefKey(ref)];
  countObject();
  if (!entry || entry.blob !== ref.blob) {
    diag(
      entry ? "HASH_MISMATCH" : "SOURCE_UNVERIFIED",
      "error",
      entry
        ? "registered brief blob does not match brief_ref.blob"
        : "brief_ref does not resolve through the fixture brief store",
      { ...ref }
    );
    return {
      status: "BLOCKED",
      planning_state: "unapproved",
      approval_ref: null,
      nodes: [placeholderNode(ref, task.objective_id, ["SOURCE_UNVERIFIED"])],
      edges: [],
      gate_status: [],
      conflicts: [],
      diagnostics: diagnostics.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)),
      quarantined_sources: quarantinedSources,
      routing_flags: routingFlags,
      complete: true,
    };
  }
  const brief = entry.brief;
  const briefErr = validateBrief(brief);
  if (briefErr) {
    diag("INVALID_BRIEF", "error", `fixture brief invalid: ${briefErr}`, { ...ref });
    return {
      status: "BLOCKED",
      planning_state: "unapproved",
      approval_ref: null,
      nodes: [placeholderNode(ref, task.objective_id, ["SOURCE_UNVERIFIED"])],
      edges: [],
      gate_status: [],
      conflicts: [],
      diagnostics: diagnostics.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)),
      quarantined_sources: quarantinedSources,
      routing_flags: routingFlags,
      complete: true,
    };
  }

  // ---- input byte budget --------------------------------------------
  const inputBytes = byteLen(canonicalJson(task)) + byteLen(canonicalJson(brief));
  if (inputBytes > BUDGET_LIMITS.maxInputBytes) {
    throw new PlannerError("INPUT_LIMIT", `total input UTF-8 bytes ${inputBytes} exceed ${BUDGET_LIMITS.maxInputBytes}`);
  }
  if (task.task_specs !== undefined) {
    // defensive: task_specs only comes from the brief, never the task
  }
  if (brief.task_specs.length > task.constraints.max_nodes) {
    throw new PlannerError(
      "INPUT_LIMIT",
      `brief declares ${brief.task_specs.length} task specs, exceeding max_nodes ${task.constraints.max_nodes}`
    );
  }
  if (brief.task_specs.length > task.constraints.budget_units) {
    throw new PlannerError(
      "BUDGET_EXCEEDED",
      `brief declares ${brief.task_specs.length} task specs, exceeding budget_units ${task.constraints.budget_units}`
    );
  }
  let spanCount = 0;
  for (const s of brief.task_specs) spanCount += (s.source_spans ?? []).length;
  if (spanCount > BUDGET_LIMITS.maxSpans) {
    throw new PlannerError("INPUT_LIMIT", `evidence spans ${spanCount} exceed ${BUDGET_LIMITS.maxSpans}`);
  }

  // ---- prohibited actions refuse the whole plan -----------------------
  for (const spec of brief.task_specs) {
    for (const a of spec.action_ids) {
      if (isProhibitedAction(a)) {
        throw new PlannerError("ACTION_DENIED", `prohibited action "${a}" requested by task spec "${spec.local_key}"; denial record only — no scripts or operational commands produced`);
      }
    }
  }

  // ---- build nodes ----------------------------------------------------
  const allowlist = task.constraints.owner_allowlist;
  const keySet = new Set(brief.task_specs.map((s) => s.local_key));
  const nodes = [];
  const nodeByKey = new Map();
  const seenKeys = new Set();

  for (const spec of brief.task_specs) {
    if (seenKeys.has(spec.local_key)) {
      diag("DUPLICATE_LOCAL_KEY", "error", `duplicate local_key "${spec.local_key}" rejected; first declaration wins`, { ...ref });
      continue;
    }
    seenKeys.add(spec.local_key);

    const taskId = stableNodeId(ref.repo, ref.path, ref.blob, task.objective_id, spec.local_key);
    const node = {
      task_id: taskId,
      local_key: spec.local_key,
      title: spec.title,
      owner_proposal: spec.owner_proposal,
      assignment_authorized: false,
      dependencies: [],
      acceptance_checks: spec.acceptance_checks.map((a) => ({ ...a })),
      external_gates: [...spec.external_gate_ids],
      evidence: [],
      uncertainty_flags: [],
      state: "PROPOSED",
      blocking_codes: [],
      routing_clearance: "unapproved",
    };
    const block = (code) => {
      if (!node.blocking_codes.includes(code)) node.blocking_codes.push(code);
      node.state = "BLOCKED";
    };

    // injection: prose is data; flagged specs are quarantined
    const scan = scanSpec(spec);
    if (scan.quarantined) {
      block("INSTRUCTION_INJECTION");
      quarantinedSources.push({ brief_ref: { ...ref }, local_key: spec.local_key, families: scan.hits.map((h) => h.family) });
      diag("INSTRUCTION_INJECTION", "error", `task spec "${spec.local_key}" prose matches injection family(s) ${scan.hits.map((h) => h.family).join(", ")}; spec quarantined`, { ...ref });
    }
    // owner must be a registered owner (and in the allowlist when non-empty)
    if (!owners.includes(spec.owner_proposal) || (allowlist.length > 0 && !allowlist.includes(spec.owner_proposal))) {
      block("INVALID_OWNER");
      diag("INVALID_OWNER", "error", `task spec "${spec.local_key}" proposes unregistered owner "${spec.owner_proposal}"`, { ...ref });
    }
    // empty acceptance gates block the node
    if (spec.acceptance_checks.length === 0) {
      block("EMPTY_ACCEPTANCE_GATE");
      diag("EMPTY_ACCEPTANCE_GATE", "error", `task spec "${spec.local_key}" declares no acceptance checks`, { ...ref });
    }
    // dependencies must resolve
    const depIds = [];
    for (const dk of spec.dependency_keys) {
      if (!keySet.has(dk)) {
        // Dangling key cannot resolve: block the node, never silently drop it.
        block("DANGLING_DEPENDENCY");
        diag("DANGLING_DEPENDENCY", "error", `task spec "${spec.local_key}" depends on unresolvable key "${dk}"`, { ...ref });
      } else {
        depIds.push(stableNodeId(ref.repo, ref.path, ref.blob, task.objective_id, dk));
        if (dk === spec.local_key) {
          // Self-dependency is a cycle; the edge is still recorded so the
          // cycle detector sees it.
          block("SELF_DEPENDENCY");
          diag("SELF_DEPENDENCY", "error", `task spec "${spec.local_key}" depends on itself`, { ...ref });
        }
      }
    }
    node.dependencies = [...new Set(depIds)].sort();

    nodes.push(node);
    nodeByKey.set(spec.local_key, node);
  }

  // ---- related-brief conflicts -----------------------------------------
  const conflicts = [];
  const related = task.related_brief_refs ?? [];
  for (const rref of related) {
    const rent = briefs[briefKey(rref)];
    countObject();
    if (!rent || rent.blob !== rref.blob) {
      diag("SOURCE_UNVERIFIED", "warning", `related brief ${rref.path}@${rref.commit.slice(0, 7)} does not resolve; ignored`, { ...rref });
      continue;
    }
    const rbrief = rent.brief;
    if (validateBrief(rbrief)) {
      diag("INVALID_BRIEF", "warning", `related brief ${rref.path} is shape-invalid; ignored`, { ...rref });
      continue;
    }
    for (const rs of rbrief.task_specs) {
      const ours = nodeByKey.get(rs.local_key);
      if (!ours) continue;
      const sameTitle = ours.title === rs.title;
      const sameActions =
        JSON.stringify([...ours.acceptance_checks].map((a) => a.check_id).sort()) ===
        JSON.stringify([...rs.acceptance_checks].map((a) => a.check_id).sort());
      if (!sameTitle || !sameActions) {
        conflicts.push({
          local_key: rs.local_key,
          brief_refs: [{ ...ref }, { ...rref }],
          reason: "SPEC_CONFLICT",
        });
        if (!ours.blocking_codes.includes("CONFLICTING_SPEC")) ours.blocking_codes.push("CONFLICTING_SPEC");
        ours.state = "BLOCKED";
        diag("CONFLICTING_SPEC", "error", `task "${rs.local_key}" conflicts between the brief and related brief ${rref.path}`, { ...ref });
      }
    }
  }

  // ---- edges ------------------------------------------------------------
  const nodeIds = nodes.map((n) => n.task_id);
  const edges = [];
  for (const n of nodes) {
    for (const d of n.dependencies) edges.push({ from: d, to: n.task_id });
  }
  edges.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : 0));

  // ---- cycles block the whole DAG ---------------------------------------
  let cyclic = false;
  if (hasCycle(nodeIds, edges)) {
    cyclic = true;
    for (const n of nodes) {
      if (!n.blocking_codes.includes("CYCLE_DETECTED")) n.blocking_codes.push("CYCLE_DETECTED");
      n.state = "BLOCKED";
    }
    diag("CYCLE_DETECTED", "error", "dependency graph contains a cycle; the whole DAG is invalid", { ...ref });
  }

  // ---- approval routing ---------------------------------------------------
  const restrictedScopeIds = [...new Set(brief.scope_ids.filter(isRestrictedScope))];
  const restrictedActionIds = [
    ...new Set(brief.task_specs.flatMap((s) => s.action_ids).filter(isRestrictedAction)),
  ];
  const isRestricted = restrictedScopeIds.length > 0 || restrictedActionIds.length > 0;
  let planningState = "unapproved";
  let approvalRef = null;
  if (isRestricted) {
    routingFlags.push("RESTRICTED_SCOPE");
    const requirement = {
      briefBlob: ref.blob,
      resource: ref.path,
      scopeIds: restrictedScopeIds,
      actionIds: restrictedActionIds,
    };
    const found = resolveApproval(approvals, requirement, clockMs);
    countObject();
    if (found.ok) {
      planningState = "approval_verified";
      approvalRef = {
        record_id: found.record.record_id,
        issuer: found.record.issuer,
        authority_origin: found.record.authority_origin,
      };
      for (const n of nodes) {
        const spec = brief.task_specs.find((s) => s.local_key === n.local_key);
        const involved = restrictedScopeIds.length > 0 || (spec && spec.action_ids.some(isRestrictedAction));
        if (involved && n.state === "PROPOSED") n.routing_clearance = "simulated_approved";
      }
      diag("APPROVAL_VERIFIED", "info", `restricted planning covered by ${found.record.record_id} (${found.record.authority_origin})`, { ...ref });
    } else {
      diag(found.code, "error", `restricted planning lacks valid Jason-origin approval: ${found.reason}`, { ...ref });
      for (const n of nodes) {
        const spec = brief.task_specs.find((s) => s.local_key === n.local_key);
        const involved = restrictedScopeIds.length > 0 || (spec && spec.action_ids.some(isRestrictedAction));
        if (involved) {
          if (!n.blocking_codes.includes("APPROVAL_REQUIRED")) n.blocking_codes.push("APPROVAL_REQUIRED");
          n.blocking_codes.push(found.code);
          n.state = "BLOCKED";
        }
      }
    }
  }

  // ---- external gates: explicit unresolved records -------------------------
  const gateIds = [...new Set(brief.task_specs.flatMap((s) => s.external_gate_ids))].sort();
  const gateStatus = gateIds.map((g) => ({
    gate_id: g,
    status: "UNRESOLVED",
    note: "external gate is an explicit unresolved record; never an executable task and never auto-cleared by this agent",
  }));

  // ---- status, order, output budgets ---------------------------------------
  const anyBlocked = nodes.some((n) => n.state === "BLOCKED");
  const status = anyBlocked ? "BLOCKED" : "PLANNED";
  if (nodes.length > BUDGET_LIMITS.maxOutputRecords) {
    throw new PlannerError("OUTPUT_LIMIT", `output records ${nodes.length} exceed ${BUDGET_LIMITS.maxOutputRecords}`);
  }

  const orderedIds = cyclic ? [...nodeIds].sort() : topoSort(nodeIds, edges);
  const byId = new Map(nodes.map((n) => [n.task_id, n]));
  const orderedNodes = orderedIds.map((id) => byId.get(id));

  const payload = {
    status,
    planning_state: planningState,
    approval_ref: approvalRef,
    nodes: orderedNodes,
    edges,
    gate_status: gateStatus,
    conflicts: conflicts.sort((a, b) => (a.local_key < b.local_key ? -1 : 1)),
    diagnostics: diagnostics.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : a.reason < b.reason ? -1 : 1)),
    quarantined_sources: quarantinedSources,
    routing_flags: [...routingFlags].sort(),
    complete: true,
  };
  if (byteLen(canonicalJson(payload)) > BUDGET_LIMITS.maxOutputBytes) {
    throw new PlannerError("OUTPUT_LIMIT", `output bytes exceed ${BUDGET_LIMITS.maxOutputBytes}`);
  }
  return payload;
}

export { sha256HexUtf8 };
