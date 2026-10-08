import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { ProgrammerAuthorizationApplication } from "@/application/developer/ProgrammerAuthorizationApplication";

import {
  fetchLatestRun,
  fetchBugFixesForRun,
} from "../../../../../../scripts/engineering-brain/persistence/readEngineeringBrainFromSupabase.mjs";
import { matchRegressions } from "../../../../../../scripts/engineering-brain/health/matchRegressions.mjs";

// Slice 5: regression awareness (advisory only).
// POST { paths: string[], revision?: string } → { exposures[] }.
// File-path overlap against the deterministic bug catalog. Never claims a
// regression occurred; never merge-blocking. Same auth posture as the
// query route: programmer-only, 404 on unauthorized.
export async function POST(request) {
  const supabase = await createClient();
  const authorization = await new ProgrammerAuthorizationApplication({ supabase }).loadAuthorization();
  if (!authorization.ok || !authorization.authorized) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const paths = Array.isArray(body.paths) ? body.paths.filter((p) => typeof p === "string") : [];
  if (paths.length === 0) {
    return NextResponse.json({ error: "Provide a non-empty paths array." }, { status: 400 });
  }
  if (paths.length > 500) {
    return NextResponse.json({ error: "Too many paths (max 500)." }, { status: 400 });
  }
  const revision = typeof body.revision === "string" ? body.revision.slice(0, 80) : null;

  const latestRun = await fetchLatestRun(supabase);
  if (!latestRun) {
    return NextResponse.json({ error: "No indexed run found yet. Run the sync workflow first." }, { status: 404 });
  }

  let bugCatalog = [];
  try {
    const rows = await fetchBugFixesForRun(supabase, latestRun.id);
    bugCatalog = rows.map((row) => ({
      sha: row.sha,
      date: row.date,
      subject: row.subject,
      pr: row.pr,
      class: row.class,
      files: row.files || [],
    }));
  } catch {
    return NextResponse.json({ error: "Unable to load the bug catalog." }, { status: 500 });
  }

  const exposures = matchRegressions({ changedPaths: paths, bugCatalog, revision });
  return NextResponse.json({ success: true, exposures, advisory: true });
}
