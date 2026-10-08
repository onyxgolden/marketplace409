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

// Slice 5: unified engineering-health snapshot. Read-only.
// Same authorization posture as the query route: programmer-only, 404 (not
// 403) on unauthorized, caller's own session so RLS does the enforcement.
// Never reports the disabled watchdog as actively monitoring.
export async function GET() {
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
    } catch {
      bugFixes = [];
    }
  }

  const health = aggregateHealth({ capabilities, latestRun, bugFixCount });
  const findings = assembleFindings({ capabilities, bugFixes });

  return NextResponse.json({ success: true, health, findings });
}
