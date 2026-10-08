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

import { expectedSlots, attributionWindow } from "./evaluateSlots.mjs";
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
 * (Kept for diagnostic summaries; slot states use slot-scoped queries.)
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

/**
 * Evaluate one slot. Evidence is queried SCOPED TO THE SLOT WINDOW —
 * never the global latest record (Slice 4 review blocker 1).
 *
 * Blocker 2: a missing GitHub Actions run ALONE is never a confirmed
 * miss. For workflow-exclusive sources, confirmed-miss requires visible
 * run history (totalFetched > 0) with the slot window empty; zero
 * history at all is ambiguous.
 *
 * Blocker 3: a failed/incomplete workflow run in the window is not
 * success — it is ambiguous (ran but did not succeed).
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

  // Slot-scoped evidence: the attribution window (nearest-slot bounded).
  // Evidence is queried FOR THE SLOT — never the global latest record.
  const slotWindow = attributionWindow(capability, slot);
  const collected = await collectEvidence(capability.id, { now: at, deps, slotWindow });
  const evidence_summary = collected.results.map((r) => ({
    adapter: r.adapter,
    attribution: r.attribution,
    ok: r.ok,
    detail: r.ok
      ? r.adapter === "supabase-table"
        ? `${r.evidence.rowCount} rows in slot window, latest ${r.evidence.latestAt}`
        : `runs in slot window: ${r.evidence.runCount} (fetched ${r.evidence.totalFetched}), latest ${r.evidence.latest ? `${r.evidence.latest.conclusion} at ${r.evidence.latest.startedAt}` : "none"}`
      : r.error,
  }));
  if (!collected.ok) {
    return { state: "ambiguous", reason: `evidence unavailable: ${collected.error}`, evidence_summary };
  }

  let sawSuccess = false;
  let sawNonSuccess = null;
  let executionRecordHealthy = false;
  let workflowHistoryVisible = false;
  let workflowRunInWindow = false;

  for (const r of collected.results) {
    if (!r.ok || !ATTRIBUTABLE.has(r.attribution)) continue;
    if (r.adapter === "supabase-table") {
      if (r.execution_record === true) executionRecordHealthy = true;
      if (r.evidence.rowCount > 0) sawSuccess = true;
    } else if (r.adapter === "github-actions") {
      if (r.evidence.totalFetched > 0) workflowHistoryVisible = true;
      if (r.evidence.latest) {
        workflowRunInWindow = true;
        if (r.evidence.latest.conclusion === "success") {
          sawSuccess = true;
        } else {
          sawNonSuccess = `workflow run in slot window concluded "${r.evidence.latest.conclusion}" — ran but did not succeed`;
        }
      }
    }
  }

  if (sawSuccess) {
    return { state: "observed-success", reason: "attributable evidence inside the slot window", evidence_summary };
  }
  if (sawNonSuccess) {
    return { state: "ambiguous", reason: sawNonSuccess, evidence_summary };
  }
  // No attributable evidence in the slot window.
  if (executionRecordHealthy) {
    return {
      state: "confirmed-miss",
      reason: "execution-attempt log healthy but empty for the slot window",
      evidence_summary,
    };
  }
  if (workflowHistoryVisible && !workflowRunInWindow) {
    // History proves the query works; the slot is genuinely empty.
    // (A missing run ALONE — no history at all — stays ambiguous.)
    return {
      state: "confirmed-miss",
      reason: "workflow run history visible but no run in the slot window",
      evidence_summary,
    };
  }
  return {
    state: "ambiguous",
    reason: "no attributable evidence in the slot window; cannot confirm a miss",
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
