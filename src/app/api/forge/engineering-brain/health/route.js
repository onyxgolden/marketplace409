import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { ProgrammerAuthorizationApplication } from "@/application/developer/ProgrammerAuthorizationApplication";

import {
  fetchLatestRun,
  countBugFixesForRun,
  fetchBugFixesForRun,
} from "../../../../../../scripts/engineering-brain/persistence/readEngineeringBrainFromSupabase.mjs";
import { getRegistry } from "../../../../../../scripts/engineering-brain/runtimeCoverageRegistry.mjs";
import { aggregateHealth } from "../../../../../../scripts/engineering-brain/health/aggregateHealth.mjs";
import { assembleFindings } from "../../../../../../scripts/engineering-brain/health/assembleFindings.mjs";
import { matchRegressions } from "../../../../../../scripts/engineering-brain/health/matchRegressions.mjs";
import { prioritizeFindings } from "../../../../../../scripts/engineering-brain/health/prioritizeFindings.mjs";
import { buildTriageQueue } from "../../../../../../scripts/engineering-brain/health/buildTriageQueue.mjs";
import { buildEvidencePacket } from "../../../../../../scripts/engineering-brain/health/buildEvidencePacket.mjs";

// Slice 5: unified engineering-health snapshot. Read-only.
// Slice 6: adds deterministic triage queue + evidence packets, computed
// server-side from the same snapshot. Still read-only; no new auth surface.
// Same authorization posture as the query route: programmer-only, 404 (not
// 403) on unauthorized, caller's own session so RLS does the enforcement.
// Never reports the disabled watchdog as actively monitoring.
export async function GET(request) {
  const supabase = await createClient();
  const authorization = await new ProgrammerAuthorizationApplication({ supabase }).loadAuthorization();
  if (!authorization.ok || !authorization.authorized) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const capabilities = getRegistry();

  let latestRun = null;
  try {
    latestRun = await fetchLatestRun(supabase);
  } catch {
    latestRun = null; // fail closed: aggregateHealth marks index "unavailable"
  }

  let bugFixCount = null;
  let bugFixes = [];
  let bugFixRowsOk = false;
  if (latestRun) {
    try {
      bugFixCount = await countBugFixesForRun(supabase, latestRun.id);
    } catch {
      bugFixCount = null;
    }
    try {
      const rows = await fetchBugFixesForRun(supabase, latestRun.id);
      bugFixes = rows.map((row) => ({
        sha: row.sha,
        date: row.date,
        subject: row.subject,
        pr: row.pr,
        class: row.class,
        files: row.files || [],
      }));
      bugFixRowsOk = true;
    } catch {
      // Row fetch failed: rows are unknown, never "zero defects".
      // aggregateHealth marks the bug section unavailable; assembleFindings
      // emits an evidence-unavailable finding.
      bugFixes = [];
      bugFixRowsOk = false;
    }
  }

  const health = aggregateHealth({ capabilities, latestRun, bugFixCount, bugFixRowsOk });
  const findings = assembleFindings({ capabilities, bugFixes, bugFixesLoadFailed: !bugFixRowsOk && latestRun !== null });

  // Slice 6: deterministic triage. Pure transforms over the same evidence;
  // no additional data sources, no writes.
  //
  // Regression exposure: at plain snapshot time there is no revision under
  // review, so no changed-paths context exists. Callers may pass
  // ?changedPaths=a,b,c (max 500, same bound as the regression-check
  // endpoint) to evaluate a hypothetical change set; exposures are then
  // computed with matchRegressions and flow into the severity boost and
  // evidence packets. Without the param, exposures are NOT computed and the
  // response marks regressionExposureEvaluated=false — the UI renders
  // "not evaluated (no changed-paths context)" instead of silently empty.
  let changedPaths = [];
  try {
    const raw = new URL(request?.url ?? "", "http://localhost").searchParams.get("changedPaths");
    if (raw) {
      changedPaths = raw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 500);
    }
  } catch {
    // No parseable URL (e.g. direct invocation in tests) → no changed paths.
    changedPaths = [];
  }
  const exposures = matchRegressions({ changedPaths, bugCatalog: bugFixes, revision: null });
  const regressionExposureEvaluated = changedPaths.length > 0;

  const prioritized = prioritizeFindings({ findings, capabilities, exposures });
  const triage = buildTriageQueue({ prioritized });
  // Evidence packets are built per item on demand by the UI from the same
  // payload; include a packet per queue item here so the client needs no
  // extra round-trip. Packets are read-only derivations.
  const packets = {};
  for (const item of triage) {
    packets[item.id] = buildEvidencePacket({
      item,
      health,
      capabilities,
      exposures,
      bugCatalog: bugFixes,
    });
  }

  return NextResponse.json({
    success: true,
    health,
    findings,
    triage,
    packets,
    regressionExposureEvaluated,
  });
}
