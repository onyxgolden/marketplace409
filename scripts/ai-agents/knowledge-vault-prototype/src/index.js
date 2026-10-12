/**
 * index.js — public entry for the knowledge-vault prototype.
 * Pure Node 24 ESM, zero runtime dependencies, zero model calls.
 *
 * run(task, context) -> result. The agent has no file-write API, no
 * network, no tool calls: it returns a detached advisory JSON snapshot.
 * Advisory output is never an execution token. A malformed request,
 * budget exhaustion, prohibited action, injection or unsupported task
 * yields a structured REFUSED/BLOCKED/UNVERIFIABLE denial — never an
 * exception and never a default success.
 */

import { canonicalJson, sha256HexUtf8, canonicalByteLength } from "./canonical.js";
import { validateTask, validateContext, SchemaError } from "./schemas.js";
import { mapQuery } from "./vocabulary.js";
import { scanQuery } from "./injection.js";
import { retrieveAnswer } from "./retriever.js";
import { makeBudget, BudgetError, BUDGET_LIMITS } from "./resolver.js";

export const AGENT_ID = "knowledge-vault";
export const SCHEMA_VERSION = "1";

function taskIdOf(task) {
  try {
    return `kv-${sha256HexUtf8(canonicalJson(task)).slice(0, 16)}`;
  } catch {
    return "kv-invalid-task";
  }
}

function baseDenial(task, status, code, severity, reason) {
  return {
    schema_version: SCHEMA_VERSION,
    agent: AGENT_ID,
    task_id: taskIdOf(task),
    advisory: true,
    fixture_only: true,
    source_refs: [],
    status,
    diagnostics: [{ code, severity, source_ref: null, record_id: null, reason }],
    quarantined_sources: [],
    routing_flags: [],
    complete: false,
    answer_text: "",
    claims: [],
    confidence: "LOW",
    contradictions: [],
    contradiction_count: 0,
    supersession_notes: [],
    steward_flags: [],
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
    (result.claims?.length ?? 0) +
    (result.contradictions?.length ?? 0) +
    (result.diagnostics?.length ?? 0) +
    (result.quarantined_sources?.length ?? 0) +
    (result.supersession_notes?.length ?? 0) +
    (result.steward_flags?.length ?? 0) +
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
    budget.countPayload(canonicalJson(task), "task payload");
  } catch (e) {
    if (e instanceof BudgetError) return baseDenial(task, "REFUSED", e.code, "error", e.message);
    throw e;
  }

  if (validated.kind === "prohibited") {
    return baseDenial(
      task,
      "REFUSED",
      "ACTION_DENIED",
      "critical",
      `prohibited action '${validated.requested_action}': this agent answers questions only; it cannot write, delete, register or mutate anything`
    );
  }

  // Injection in the query refuses before any mapping or retrieval.
  const qInj = scanQuery(validated.query);
  if (qInj.injected) {
    return baseDenial(task, "REFUSED", "INSTRUCTION_INJECTION", "critical", "query contains seeded directive content; refused, no retrieval performed");
  }

  let ctx;
  try {
    ctx = validateContext(context);
  } catch (e) {
    if (e instanceof SchemaError) return baseDenial(task, "REFUSED", "INVALID_INPUT", "error", `context: ${e.message}`);
    throw e;
  }

  // query_key: explicit or mapped through the bounded vocabulary.
  let query_key = validated.query_key;
  let matchedPhrases = [];
  if (query_key === null) {
    const mapped = mapQuery(validated.query, ctx.vocabulary);
    if (mapped.status === "unsupported") {
      return baseDenial(task, "REFUSED", "UNSUPPORTED_TASK", "error", "query does not map to any fixture vocabulary query_key; no claims guessed");
    }
    if (mapped.status === "ambiguous") {
      const r = baseDenial(task, "UNVERIFIABLE", "UNSUPPORTED_TASK", "warning", `query is ambiguous between query_keys [${mapped.candidates.join(", ")}]; clarification required, no claims made`);
      return r;
    }
    query_key = mapped.query_key;
    matchedPhrases = mapped.matchedPhrases;
  } else if (!ctx.vocabulary.some((e) => e.query_key === query_key)) {
    return baseDenial(task, "REFUSED", "UNSUPPORTED_TASK", "error", `query_key '${query_key}' is not in the fixture vocabulary`);
  }

  try {
    const payload = retrieveAnswer({
      query: validated.query,
      query_key,
      matchedPhrases,
      task: validated,
      ctx,
      clockMs: ctx.clock,
      budget,
    });
    const result = envelope(task, {
      status: payload.status,
      answer_text: payload.answer_text,
      claims: payload.claims,
      confidence: payload.confidence,
      contradictions: payload.contradictions,
      contradiction_count: payload.contradiction_count,
      supersession_notes: payload.supersession_notes,
      steward_flags: payload.steward_flags,
      diagnostics: payload.diagnostics,
      quarantined_sources: payload.quarantined_sources,
      routing_flags: [],
      complete: payload.status === "ANSWERED",
    });
    if (!finalEnvelopeWithinBudget(result)) {
      return baseDenial(task, "REFUSED", "OUTPUT_LIMIT", "error", `final output envelope exceeds ${BUDGET_LIMITS.maxOutputBytes} bytes`);
    }
    return result;
  } catch (e) {
    if (e instanceof BudgetError) return baseDenial(task, "REFUSED", e.code, "error", e.message);
    if (e instanceof SchemaError) return baseDenial(task, "REFUSED", "INVALID_INPUT", "error", e.message);
    throw e;
  }
}

export { validateTask, validateContext, BUDGET_LIMITS, canonicalJson, sha256HexUtf8, makeBudget };
export { mapQuery } from "./vocabulary.js";
export { parseClaims } from "./retriever.js";
