import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { ProgrammerAuthorizationApplication } from "@/application/developer/ProgrammerAuthorizationApplication";

import { fetchLatestRun } from "../../../../../../scripts/engineering-brain/persistence/readEngineeringBrainFromSupabase.mjs";
import { runQuery } from "../../../../../../scripts/engineering-brain/query/runQuery.mjs";

const MAX_RECORDS_PER_RUN = 10000;

// Uses the caller's own cookie-based session (not a service-role key) -- RLS's is_forge_programmer()
// check does the real enforcement here, the same predicate Postgres itself trusts, so this route
// can never grant more than the database already would. 404, not 403, on an unauthorized request:
// same "don't reveal this exists" behavior as /forge/developer's own page-level notFound() gate.
//
// Excerpts are never resolved here (resolveExcerpts: false) -- excerpt resolution re-fetches source
// via `git show` against the local repository, which a deployed Vercel function has no access to.
// Results carry full citations (path, symbol, authority, commit, hash) but no inline content
// preview; that trade was made explicitly rather than extending the schema to store raw source text
// a second time.
export async function GET(request) {
  const supabase = await createClient();
  const authorization = await new ProgrammerAuthorizationApplication({ supabase }).loadAuthorization();
  if (!authorization.ok || !authorization.authorized) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const queryText = searchParams.get("q") || "";
  const filters = {};
  if (searchParams.get("sourceType")) filters.sourceType = searchParams.get("sourceType");
  if (searchParams.get("authorityLevel")) filters.authorityLevel = searchParams.get("authorityLevel");
  if (searchParams.get("table")) filters.table = searchParams.get("table");
  const maxResultsParam = Number(searchParams.get("maxResults"));
  const maxResults = Number.isFinite(maxResultsParam) && maxResultsParam > 0 ? Math.min(maxResultsParam, 100) : 30;

  const latestRun = await fetchLatestRun(supabase);
  if (!latestRun) {
    return NextResponse.json({ error: "No indexed run found yet. Run the sync workflow first." }, { status: 404 });
  }

  const { data: records, error } = await supabase
    .from("engineering_brain_records")
    .select("source_path, source_type, symbol_or_section, commit_sha, content_hash, authority_level, version, details")
    .eq("run_id", latestRun.id)
    .limit(MAX_RECORDS_PER_RUN);
  if (error) return NextResponse.json({ error: "Unable to load the index." }, { status: 500 });

  const manifest = {
    schema_version: "1.0",
    commit_sha: latestRun.commit_sha,
    index_content_hash: latestRun.index_content_hash,
    records: records || [],
  };

  const result = runQuery({ manifest, queryText, filters, maxResults, resolveExcerpts: false });

  return NextResponse.json({
    success: true,
    latestRun: {
      generatedAt: latestRun.generated_at,
      commitSha: latestRun.commit_sha,
      extractorVersion: latestRun.extractor_version,
    },
    ...result,
  });
}
