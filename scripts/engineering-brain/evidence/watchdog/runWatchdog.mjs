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

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
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
  if (!existsSync(stateFile)) return {};
  // Fail closed on malformed state: throw so the caller aborts WITHOUT
  // overwriting the file. Silently resetting to {} would destroy
  // deduplication history (review blocker).
  const raw = readFileSync(stateFile, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`alert state file is not valid JSON: ${e.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("alert state file does not contain a JSON object");
  }
  return parsed;
}

function saveAlertState(stateFile, state) {
  mkdirSync(dirname(stateFile), { recursive: true });
  // Atomic write (Slice 4 re-review): write temp + rename so a crash
  // mid-write never leaves a corrupt state file.
  const tmp = `${stateFile}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, stateFile);
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
 * Blocker 2 (re-review): a missing GitHub Actions run ALONE is never a
 * confirmed miss — and under the approved architecture, GitHub-only
 * absence REMAINS ambiguous even with visible history. GitHub Actions
 * history is secondary diagnostic evidence, not durable execution
 * evidence. Confirmed-miss requires a healthy, empty execution-attempt
 * log (Supabase) for the slot window.
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
        : `runs in slot window: ${r.evidence.runCount} (fetched ${r.evidence.totalFetched}), conclusions: ${(r.evidence.runs || []).map((x) => x.conclusion).join(", ") || "none"}`
      : r.error,
  }));
  if (!collected.ok) {
    return { state: "ambiguous", reason: `evidence unavailable: ${collected.error}`, evidence_summary };
  }

  let sawSuccess = false;
  let sawNonSuccess = null;
  let executionRecordHealthy = false;

  for (const r of collected.results) {
    if (!r.ok || !ATTRIBUTABLE.has(r.attribution)) continue;
    if (r.adapter === "supabase-table") {
      if (r.execution_record === true) executionRecordHealthy = true;
      if (r.evidence.rowCount > 0) sawSuccess = true;
    } else if (r.adapter === "github-actions") {
      // Aggregate ALL in-window runs, not just the latest. A success
      // anywhere in the window proves the capability executed — a later
      // failure does not erase the earlier success (review blocker).
      const runs = Array.isArray(r.evidence.runs) ? r.evidence.runs : (r.evidence.latest ? [r.evidence.latest] : []);
      for (const run of runs) {
        if (run.conclusion === "success") {
          sawSuccess = true;
        } else if (!sawNonSuccess) {
          sawNonSuccess = `workflow run in slot window concluded "${run.conclusion}" — ran but did not succeed`;
        }
      }
      // NOTE: no confirmed-miss from GitHub absence. Actions history is
      // secondary diagnostic evidence; a missing run is ambiguous, never
      // a confirmed miss (approved architecture).
    }
  }

  if (sawSuccess) {
    return { state: "observed-success", reason: "attributable evidence inside the slot window", evidence_summary };
  }
  if (sawNonSuccess) {
    return { state: "ambiguous", reason: sawNonSuccess, evidence_summary };
  }
  // No attributable evidence in the slot window.
  // Confirmed-miss ONLY from a healthy, empty execution-attempt log
  // (durable evidence). GitHub-only absence stays ambiguous.
  if (executionRecordHealthy) {
    return {
      state: "confirmed-miss",
      reason: "execution-attempt log healthy but empty for the slot window",
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
  let state;
  try {
    state = loadAlertState(stateFile);
  } catch (e) {
    // Fail closed: a corrupt/unreadable state file must NOT be overwritten
    // (that would destroy deduplication history). Abort the run; the
    // operator fixes or removes the file explicitly.
    const reason = `alert state unreadable: ${e.message}`;
    console.error(`watchdog: ${reason} (${stateFile}); aborting without writing`);
    return {
      alerts: [],
      resolved: [],
      summary: {
        evaluated_at: new Date(at).toISOString(),
        capabilities_evaluated: 0,
        new_alerts: 0,
        resolved: 0,
        aborted: true,
        abort_reason: reason,
      },
    };
  }
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
