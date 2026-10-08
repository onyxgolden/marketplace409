/**
 * aggregateHealth.mjs — Slice 5: pure aggregation of Brain health signals.
 *
 * Combines the static runtime-coverage registry, the latest index run
 * metadata, and bug-catalog stats into a single health snapshot. Every
 * section carries an explicit state and provenance; nothing is fabricated.
 *
 * Health states:
 *   "confirmed"    — derived from real, fresh evidence
 *   "suspected"    — evidence suggests but does not prove
 *   "unavailable"  — evidence source missing or unreadable
 *   "stale"        — evidence exists but is older than its expected cadence
 *   "not-enabled"  — the capability exists but its monitor is not running
 *
 * The independent watchdog scheduler is DISABLED. This module must never
 * report it as actively monitoring; it reports "not-enabled" with an
 * explicit note.
 */

export const HEALTH_STATES = Object.freeze([
  "confirmed",
  "suspected",
  "unavailable",
  "stale",
  "not-enabled",
]);

/** Capabilities whose evidence is expected at least this often (ms). */
const STALE_AFTER_MS = 36 * 60 * 60 * 1000; // 36h — generous for daily cadences

/**
 * @param {object} input
 * @param {Array}  input.capabilities  — CAPABILITIES registry entries
 * @param {object|null} input.latestRun — {generated_at, commit_sha, extractor_version} or null
 * @param {number|null} input.bugFixCount — number of bug fixes in latest run, or null if unknown
 * @param {boolean} [input.bugFixRowsOk=true] — false when the bug-fix count
 *   succeeded but fetching the actual rows failed; the defect list is then
 *   unknown, never "zero defects"
 * @param {number} [input.now] — epoch ms, defaults to Date.now()
 * @returns {object} health snapshot
 */
export function aggregateHealth({ capabilities, latestRun, bugFixCount, bugFixRowsOk = true, now = Date.now() }) {
  const caps = Array.isArray(capabilities) ? capabilities : [];

  // --- runtime coverage section ---
  const byStatus = {};
  for (const cap of caps) {
    const s = cap.monitoring_status || "unable-to-verify";
    byStatus[s] = (byStatus[s] || 0) + 1;
  }
  const coverageState = caps.length === 0 ? "unavailable" : "confirmed";

  // --- index freshness section ---
  let indexSection;
  if (!latestRun || !latestRun.generated_at) {
    indexSection = {
      state: "unavailable",
      provenance: "supabase:engineering_brain_runs (no run found)",
      detail: "No indexed run found. Run the sync workflow first.",
      generatedAt: null,
      commitSha: null,
    };
  } else {
    const generatedMs = Date.parse(latestRun.generated_at);
    // Fail closed on untrustworthy timestamps: an unparseable or future-dated
    // timestamp must never be reported as fresh/confirmed.
    if (!Number.isFinite(generatedMs)) {
      indexSection = {
        state: "unavailable",
        provenance: "supabase:engineering_brain_runs (latest)",
        detail: `Latest index run has an invalid timestamp (${latestRun.generated_at}). Treated as unavailable, not fresh.`,
        generatedAt: latestRun.generated_at,
        commitSha: latestRun.commit_sha || null,
        extractorVersion: latestRun.extractor_version || null,
      };
    } else if (generatedMs > now) {
      indexSection = {
        state: "stale",
        provenance: "supabase:engineering_brain_runs (latest)",
        detail: `Latest index run is future-dated (${latestRun.generated_at}). Its time claim is untrustworthy; treated as stale, not fresh.`,
        generatedAt: latestRun.generated_at,
        commitSha: latestRun.commit_sha || null,
        extractorVersion: latestRun.extractor_version || null,
      };
    } else {
      const ageMs = now - generatedMs;
      const stale = ageMs > STALE_AFTER_MS;
      indexSection = {
        state: stale ? "stale" : "confirmed",
        provenance: "supabase:engineering_brain_runs (latest)",
        detail: stale
          ? `Latest index run is older than 36h (${latestRun.generated_at}).`
          : "Index is fresh.",
        generatedAt: latestRun.generated_at,
        commitSha: latestRun.commit_sha || null,
        extractorVersion: latestRun.extractor_version || null,
      };
    }
  }

  // --- bug catalog section ---
  // Distinguish "zero defects on record" (count=0, rows loaded OK) from
  // "could not load defect rows" (count known or unknown, rows failed).
  // The latter is UNAVAILABLE — never "no defects", which would imply
  // healthy coverage from a failed read.
  let bugSection;
  if (typeof bugFixCount !== "number") {
    bugSection = {
      state: "unavailable",
      provenance: "supabase:engineering_brain_bug_fixes",
      detail: "Bug catalog unreadable or not yet migrated.",
      count: null,
      rowsOk: false,
    };
  } else if (!bugFixRowsOk) {
    bugSection = {
      state: "unavailable",
      provenance: "supabase:engineering_brain_bug_fixes (latest run)",
      detail:
        `Count query reported ${bugFixCount} fixes, but row details could not be loaded. ` +
        "The defect list is unknown — not confirmed empty.",
      count: bugFixCount,
      rowsOk: false,
    };
  } else {
    bugSection = {
      state: "confirmed",
      provenance: "supabase:engineering_brain_bug_fixes (latest run)",
      detail: `${bugFixCount} recorded fixes in the latest indexed run.`,
      count: bugFixCount,
      rowsOk: true,
    };
  }

  // --- watchdog section: DISABLED by operator decision. Never "confirmed". ---
  const watchdogSection = {
    state: "not-enabled",
    provenance: "operator configuration (not derived from monitoring)",
    detail:
      "The independent watchdog scheduler is disabled. It is not actively monitoring. " +
      "The daily cron-fire-daily-check remains the running stand-in.",
    enabled: false,
  };

  return {
    generatedAt: new Date(now).toISOString(),
    runtimeCoverage: {
      state: coverageState,
      provenance: "scripts/engineering-brain/runtimeCoverageRegistry.mjs (static registry)",
      totalCapabilities: caps.length,
      byMonitoringStatus: byStatus,
      capabilities: caps.map((c) => ({
        id: c.id,
        name: c.name,
        monitoringStatus: c.monitoring_status || "unable-to-verify",
        monitoringNote: c.monitoring_note || null,
        expectedCadence: c.expected_cadence || null,
        executionPath: c.execution_path || null,
      })),
    },
    index: indexSection,
    bugCatalog: bugSection,
    watchdog: watchdogSection,
  };
}
