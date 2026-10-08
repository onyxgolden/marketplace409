// runWatchdog (Slice 4 / W2+W3) — the independent watchdog runner.
//
// Reads the registry, computes expected slots, evaluates the most recent
// expired slot per capability, and emits alerts for confirmed-miss,
// ambiguous, and configuration-error — deduped by (capability, slot) so
// repeated runs do not spam.
//
// Hard gates (from the architecture verdict):
// - No automatic refire. Ever. The watchdog holds no CRON_SECRET and
//   cannot invoke cron endpoints.
// - No second automated firer: this runner only reads evidence.
// - Alerts are records (stdout + alert log). Delivery to a human is the
//   operator's existing channel; this module invents no new outbound path.
// - A missing GitHub Actions run is never alone sufficient for
//   confirmed-miss; durable evidence is required.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expectedSlots } from "./evaluateSlots.mjs";
import { collectEvidence } from "../collectEvidence.mjs";
import { getAdapterSpec } from "../evidenceAdapters.mjs";
import { CAPABILITIES, getCapability } from "../../runtimeCoverageRegistry.mjs";

const ATTRIBUTABLE = new Set(["sweep-exclusive", "discriminator", "workflow-exclusive"]);
const ALERTABLE = new Set(["confirmed-miss", "ambiguous", "configuration-error"]);

function slotKey(capabilityId, expectedAt) {
  return `${capabilityId}|${expectedAt}`;
}

function loadAlertState(stateFile) {
  try {
    if (!existsSync(stateFile)) return {};
    return JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    return {};
  }
}

function saveAlertState(stateFile, state) {
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

/**
 * Latest attributable timestamp from collected results, or null.
 * Returns { at, source } for the freshest attributable evidence.
 */
function freshestAttributable(collected) {
  let best = null;
  for (const r of collected.results) {
    if (!r.ok || !ATTRIBUTABLE.has(r.attribution)) continue;
    let at = null;
    if (r.adapter === "supabase-table" && r.evidence) at = r.evidence.latestAt;
    if (r.adapter === "github-actions" && r.evidence && r.evidence.latest) at = r.evidence.latest.startedAt;
    if (typeof at === "string" && (!best || at > best.at)) {
      best = { at, source: r.attribution, adapter: r.adapter };
    }
  }
  return best;
}

function hasExecutionRecord(collected) {
  return collected.results.some(
    (r) => r.ok && ATTRIBUTABLE.has(r.attribution) && r.execution_record === true
  );
}

function hasWorkflowExclusive(collected) {
  return collected.results.some(
    (r) => r.ok && r.attribution === "workflow-exclusive"
  );
}

/**
 * Evaluate one slot. Returns { state, reason, evidence_summary }.
 * repoRoot is used for the configuration check (workflow files exist).
 */
export async function evaluateSlot(capability, slot, { now, deps, repoRoot }) {
  const at = Number.isFinite(now) ? now : Date.now();
  const expectedMs = Date.parse(slot.expected_at);
  const graceMs = slot.grace_hours * 3600000;
  if (at < expectedMs + graceMs) {
    return { state: "pending", reason: "grace has not expired", evidence_summary: [] };
  }

  // Configuration check first: the registry must agree with the repo.
  const spec = getAdapterSpec(capability.id);
  if (spec) {
    for (const a of spec.adapters) {
      if (a.type === "github-actions" && repoRoot) {
        const wfPath = join(repoRoot, ".github", "workflows", a.workflowFile);
        if (!existsSync(wfPath)) {
          return {
            state: "configuration-error",
            reason: `registry names workflow ${a.workflowFile} which does not exist in the repo`,
            evidence_summary: [],
          };
        }
      }
    }
  }

  const collected = await collectEvidence(capability.id, { now: at, deps });
  const evidence_summary = collected.results.map((r) => ({
    adapter: r.adapter,
    attribution: r.attribution,
    ok: r.ok,
    detail: r.ok
      ? r.adapter === "supabase-table"
        ? `${r.evidence.rowCount} rows, latest ${r.evidence.latestAt}`
        : `latest run ${r.evidence.latest ? `${r.evidence.latest.conclusion} at ${r.evidence.latest.startedAt}` : "none"}`
      : r.error,
  }));
  if (!collected.ok) {
    return { state: "ambiguous", reason: `evidence unavailable: ${collected.error}`, evidence_summary };
  }

  const best = freshestAttributable(collected);
  const windowStart = expectedMs - 3600000;
  const windowEnd = expectedMs + graceMs;
  if (best) {
    const t = Date.parse(best.at);
    if (Number.isFinite(t) && t >= windowStart && t <= windowEnd) {
      return {
        state: "observed-success",
        reason: `attributable evidence at ${best.at} (${best.source}) inside the slot window`,
        evidence_summary,
      };
    }
  }

  // No attributable evidence in the slot window. Confirmed-miss only
  // where a mark is mandatory: execution-attempt logs and
  // workflow-exclusive runs. Otherwise ambiguous (idle vs missed).
  if (hasExecutionRecord(collected) || hasWorkflowExclusive(collected)) {
    return {
      state: "confirmed-miss",
      reason: best
        ? `no attributable evidence in the slot window; freshest is ${best.at}`
        : "no attributable evidence in the slot window",
      evidence_summary,
    };
  }
  return {
    state: "ambiguous",
    reason: best
      ? `freshest attributable evidence ${best.at} is outside the slot window; business effects cannot confirm a miss`
      : "no attributable evidence in the slot window; business effects cannot confirm a miss",
    evidence_summary,
  };
}

/**
 * Build the W3 diagnostic packet for an alerted slot.
 */
export function diagnosticPacket(capability, slot, evaluation, evaluatedAt) {
  return {
    packet: "watchdog-diagnostic",
    capability_id: capability.id,
    capability_name: capability.name,
    moves_money: capability.moves_money,
    slot_expected_at_utc: slot.expected_at,
    slot_grace_hours: slot.grace_hours,
    schedule: capability.trigger.kind === "schedule"
      ? {
          dst: capability.trigger.dst,
          cron: capability.trigger.cron || capability.trigger.crons,
          chicago_label: capability.trigger.chicago_label,
        }
      : { kind: "event", description: capability.trigger.description },
    state: evaluation.state,
    reason: evaluation.reason,
    evaluated_at: new Date(evaluatedAt).toISOString(),
    evidence_queried: evaluation.evidence_summary,
    recovery: {
      note: "Refire is an explicit human action. The watchdog never refires and holds no credentials.",
      execution_path: capability.execution_path,
      suggested_checks: [
        `Verify the scheduler fired: GitHub Actions workflow runs for the expected slot.`,
        `Check durable evidence directly: query the evidence sources listed above.`,
        `If a miss is confirmed, re-fire through the authorized path (${capability.execution_path}), then re-run the watchdog to observe recovery.`,
      ],
    },
  };
}

/**
 * Run the watchdog over all capabilities.
 *
 * opts: { now, deps, repoRoot, stateFile }
 * Returns { alerts: [packets], resolved: [slotKeys], summary }.
 * New alerts are those in an alertable state whose slot has no open alert.
 * Slots that were alerted and are now observed-success/pending are resolved.
 */
export async function runWatchdog({ now, deps, repoRoot, stateFile }) {
  const at = Number.isFinite(now) ? now : Date.now();
  const state = loadAlertState(stateFile);
  const alerts = [];
  const resolved = [];

  for (const capability of CAPABILITIES) {
    const slots = expectedSlots(capability, at);
    // Most recent expired slot only — the watchdog watches the latest
    // expected execution, not history.
    const slot = slots.find((s) => at >= Date.parse(s.expected_at) + s.grace_hours * 3600000);
    if (!slot) continue;
    const evaluation = await evaluateSlot(capability, slot, { now: at, deps, repoRoot });
    const key = slotKey(capability.id, slot.expected_at);
    const open = state[key] && !state[key].resolved_at;

    if (ALERTABLE.has(evaluation.state)) {
      if (!open) {
        const packet = diagnosticPacket(capability, slot, evaluation, at);
        alerts.push(packet);
        state[key] = {
          state: evaluation.state,
          first_seen_at: new Date(at).toISOString(),
          resolved_at: null,
        };
      }
    } else if (open) {
      state[key].resolved_at = new Date(at).toISOString();
      state[key].resolved_state = evaluation.state;
      resolved.push(key);
    }
  }

  saveAlertState(stateFile, state);
  const summary = {
    evaluated_at: new Date(at).toISOString(),
    capabilities_evaluated: CAPABILITIES.length,
    new_alerts: alerts.length,
    resolved: resolved.length,
  };
  return { alerts, resolved, summary };
}

export function defaultStateFile() {
  const home = process.env.HOME || process.env.USERPROFILE || ".";
  return join(home, "workspace", "brain-watchdog", "alert-state.json");
}

export function repoRootDefault() {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
}
