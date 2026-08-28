import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_MANIFEST_PATH = path.join("engineering-brain", "index-manifest.json");
const BATCH_SIZE = 500;

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) chunks.push(array.slice(i, i + size));
  return chunks;
}

// Same env vars and client options as the established CLI-script pattern
// (scripts/scheduling/verifyCpmEngineAgainstRealProjects.mjs) -- a plain service-role client, not
// the cookie-based Next.js SSR client (src/lib/supabase/server.js), since this runs outside any
// request context.
export function createSupabaseServiceClient({ url = process.env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY } = {}) {
  if (!url || !serviceRoleKey) {
    throw new Error("Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function loadManifestFromDisk(manifestPath) {
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

// Idempotent: re-syncing the same commit+index_content_hash is a safe no-op. The migration's unique
// (commit_sha, index_content_hash) constraint is what actually enforces this at the database level;
// this check just avoids a wasted round-trip preparing thousands of rows only to have Postgres
// reject the insert.
export async function findExistingRun(supabaseClient, { commitSha, indexContentHash }) {
  const { data, error } = await supabaseClient
    .from("engineering_brain_runs")
    .select("id")
    .eq("commit_sha", commitSha)
    .eq("index_content_hash", indexContentHash)
    .maybeSingle();
  if (error) throw new Error(`Failed to check for an existing run: ${error.message}`);
  return data?.id ?? null;
}

export function manifestToRunRow(manifest, runId) {
  return {
    id: runId,
    commit_sha: manifest.commit_sha,
    extractor_version: manifest.extractor_version,
    schema_version: manifest.schema_version,
    index_content_hash: manifest.index_content_hash,
    generated_at: manifest.generated_at,
    counts: manifest.counts,
  };
}

export function manifestRecordToRow(record, runId, index) {
  return {
    run_id: runId,
    id: `record_${index}`,
    source_path: record.source_path,
    source_type: record.source_type,
    symbol_or_section: record.symbol_or_section,
    commit_sha: record.commit_sha,
    content_hash: record.content_hash,
    authority_level: record.authority_level,
    version: record.version,
    details: record.details,
  };
}

export function manifestExcludedToRow(excluded, runId, index) {
  return {
    run_id: runId,
    id: `excluded_${index}`,
    source_path: excluded.source_path,
    reason: excluded.reason,
  };
}

export async function syncManifestToSupabase({ supabaseClient, manifest }) {
  const existingRunId = await findExistingRun(supabaseClient, {
    commitSha: manifest.commit_sha,
    indexContentHash: manifest.index_content_hash,
  });
  if (existingRunId) {
    return { skipped: true, runId: existingRunId, reason: "This exact commit + index content hash is already synced." };
  }

  const runId = `engbrain_run_${manifest.commit_sha.slice(0, 12)}_${Date.now()}`;
  const runRow = manifestToRunRow(manifest, runId);
  const { error: runError } = await supabaseClient.from("engineering_brain_runs").insert(runRow);
  if (runError) throw new Error(`Failed to insert run: ${runError.message}`);

  const recordRows = manifest.records.map((record, index) => manifestRecordToRow(record, runId, index));
  for (const batch of chunk(recordRows, BATCH_SIZE)) {
    const { error } = await supabaseClient.from("engineering_brain_records").insert(batch);
    if (error) throw new Error(`Failed to insert a batch of records: ${error.message}`);
  }

  const excludedRows = (manifest.excluded || []).map((excluded, index) => manifestExcludedToRow(excluded, runId, index));
  for (const batch of chunk(excludedRows, BATCH_SIZE)) {
    const { error } = await supabaseClient.from("engineering_brain_excluded").insert(batch);
    if (error) throw new Error(`Failed to insert a batch of excluded rows: ${error.message}`);
  }

  return { skipped: false, runId, recordCount: recordRows.length, excludedCount: excludedRows.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const manifestPath = process.argv[2] || DEFAULT_MANIFEST_PATH;
  const manifest = loadManifestFromDisk(manifestPath);
  const supabaseClient = createSupabaseServiceClient();
  syncManifestToSupabase({ supabaseClient, manifest })
    .then((result) => {
      if (result.skipped) {
        console.log(`Skipped: ${result.reason} (run ${result.runId})`);
      } else {
        console.log(`Synced run ${result.runId}: ${result.recordCount} records, ${result.excludedCount} excluded.`);
      }
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
