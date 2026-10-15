/**
 * index.js — public entry for the property-manager prototype.
 * Pure Node 24 ESM, zero runtime dependencies, zero model calls.
 *
 * run(task, context) -> result. The agent has no file-write API, no
 * network, no tool calls: it returns a detached advisory JSON snapshot.
 * Advisory output is never an execution token. A malformed request,
 * budget exhaustion, prohibited action, injection or unsupported task
 * yields a structured REFUSED/BLOCKED denial — never an exception and
 * never a default success.
 *
 * The agent proposes deterministic recommendations and escalation
 * records only. It cannot charge, message, waive, edit, dispatch, or
 * determine legal questions: execution_authorized_for_agent is always
 * false.
 */

import { canonicalJson, sha256HexUtf8, canonicalByteLength } from "./canonical.js";
import { validateTask, validateContext, SchemaError, PROHIBITED_ACTIONS } from "./schemas.js";
import { makeBudget, BudgetError, BUDGET_LIMITS } from "./resolver.js";
import { scanRealIdentifiers } from "./injection.js";
import {
  EngineRefusal,
  resolveCase,
  checkWorkflow,
  checkScope,
  screenNote,
  buildAdvisory,
} from "./engine.js";

export const AGENT_ID = "property-manager";
export const SCHEMA_VERSION = "1";

function taskIdOf(task) {
  try {
    return `pm-${sha256HexUtf8(canonicalJson(task)).slice(0, 16)}`;
  } catch {
    return "pm-invalid-task";
  }
}

function baseDenial(task, status, code, severity, reason, quarantine = []) {
  return {
    schema_version: SCHEMA_VERSION,
    agent: AGENT_ID,
    task_id: taskIdOf(task),
    advisory: true,
    fixture_only: true,
    source_refs: [],
    status,
    diagnostics: [{ code, severity, source_ref: null, record_id: null, reason }],
    quarantined_sources: quarantine,
    routing_flags: [],
    complete: false,
    recommendations: [],
    escalation_triggers: [],
    contradictions: [],
  };
}

function envelope(task, payload) {
  return {
    schema_version: SCHEMA_VERSION,
    agent: AGENT_ID,
    task_id: taskIdOf(task),
    advisory: true,
    fixture_only: true,
    source_refs: [],
    ...payload,
  };
}

/** Output-record budget model over the defined output records. */
function outputRecords(result) {
  return (
    (result.recommendations?.length ?? 0) +
    (result.escalation_triggers?.length ?? 0) +
    (result.contradictions?.length ?? 0) +
    (result.diagnostics?.length ?? 0) +
    (result.quarantined_sources?.length ?? 0) +
    (result.routing_flags?.length ?? 0) +
    (result.source_refs?.length ?? 0)
  );
}

function finalEnvelopeWithinBudget(result) {
  if (outputRecords(result) > BUDGET_LIMITS.maxOutputRecords) return false;
  return canonicalByteLength(result) <= BUDGET_LIMITS.maxOutputBytes;
}

export function run(task, context) {
  let validated;
  try {
    const clock = context && context.clock;
    if (!Number.isFinite(clock)) throw new SchemaError("context.clock must be a finite number");
    validated = validateTask(task);
  } catch (e) {
    if (e instanceof SchemaError) return baseDenial(task, "REFUSED", "INVALID_INPUT", "error", e.message);
    throw e;
  }

  let budget;
  try {
    budget = makeBudget();
    budget.countPayload(canonicalByteLength(task), "task payload");
  } catch (e) {
    if (e instanceof BudgetError) return baseDenial(task, "REFUSED", e.code, "error", e.message);
    throw e;
  }

  // Real identifiers / PII canaries in task content: reject without echoing.
  const realId = scanRealIdentifiers([
    validated.note,
    ...(validated.claimed_relay_ids ?? []),
    validated.case_ref.case_id,
  ]);
  if (realId.found) {
    return baseDenial(
      task,
      "REFUSED",
      "INVALID_INPUT",
      "critical",
      `task carries unregistered identifier content (${realId.kind}); fixture cases use invented SYN-* IDs only`
    );
  }

  // Prohibited operations refuse before any case work.
  if (PROHIBITED_ACTIONS.has(validated.requested_action)) {
    return baseDenial(
      task,
      "REFUSED",
      "ACTION_DENIED",
      "critical",
      `prohibited action '${validated.requested_action}': this agent proposes recommendations only; it cannot charge, message, waive, edit, dispatch or advise legally`
    );
  }
  if (validated.requested_action !== "recommend") {
    return baseDenial(task, "REFUSED", "UNSUPPORTED_TASK", "error", `unsupported requested_action '${validated.requested_action}': this agent only recommends`);
  }

  let ctx;
  try {
    ctx = validateContext(context, budget);
  } catch (e) {
    if (e instanceof BudgetError) return baseDenial(task, "REFUSED", e.code, "error", `context: ${e.message}`);
    if (e instanceof SchemaError) return baseDenial(task, "REFUSED", "INVALID_INPUT", "error", `context: ${e.message}`);
    throw e;
  }

  try {
    screenNote(validated);
    const c = resolveCase(validated, ctx, budget);
    checkWorkflow(validated, c);
    checkScope(validated, c);
    const advisory = buildAdvisory(validated, c, ctx, budget);
    const result = envelope(task, {
      status: advisory.status,
      diagnostics: advisory.diagnostics,
      quarantined_sources: [],
      routing_flags: [],
      complete: advisory.status === "PROPOSED",
      recommendations: advisory.recommendations,
      escalation_triggers: advisory.escalation_triggers,
      contradictions: advisory.contradictions,
    });
    if (!finalEnvelopeWithinBudget(result)) {
      return baseDenial(task, "REFUSED", "OUTPUT_LIMIT", "error", `final output envelope exceeds ${BUDGET_LIMITS.maxOutputBytes} bytes`);
    }
    return result;
  } catch (e) {
    if (e instanceof EngineRefusal) {
      return baseDenial(task, e.status, e.code, e.severity, e.reason, e.quarantine);
    }
    if (e instanceof BudgetError) return baseDenial(task, "REFUSED", e.code, "error", e.message);
    if (e instanceof SchemaError) return baseDenial(task, "REFUSED", "INVALID_INPUT", "error", e.message);
    throw e;
  }
}

export { validateTask, validateContext, BUDGET_LIMITS, canonicalJson, sha256HexUtf8, makeBudget };
