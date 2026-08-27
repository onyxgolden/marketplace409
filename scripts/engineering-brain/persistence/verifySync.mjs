import { findExistingRun } from "./syncManifestToSupabase.mjs";
import { countRecordsForRun, countExcludedForRun } from "./readEngineeringBrainFromSupabase.mjs";

export class SyncVerificationError extends Error {
  constructor(reason) {
    super(`Sync verification failed: ${reason}`);
    this.name = "SyncVerificationError";
  }
}

// Run immediately after syncManifestToSupabase.mjs, in CI and locally: a sync call returning without
// throwing only proves each individual insert call succeeded, not that the database actually ended
// up holding what the manifest says it should. This independently re-reads the row counts Postgres
// itself reports for the run just written (or skipped as already-synced) and compares them against
// the manifest's own counts -- catching e.g. a partial batch failure that got swallowed, a duplicate
// run some other process raced in, or a schema drift silently dropping rows. Fails loudly rather
// than letting an automated job report false success.
export async function verifySync({ supabaseClient, manifest }) {
  const runId = await findExistingRun(supabaseClient, {
    commitSha: manifest.commit_sha,
    indexContentHash: manifest.index_content_hash,
  });
  if (!runId) {
    throw new SyncVerificationError(`No run found in Supabase for commit ${manifest.commit_sha} / index_content_hash ${manifest.index_content_hash}.`);
  }

  const [recordCount, excludedCount] = await Promise.all([
    countRecordsForRun(supabaseClient, runId),
    countExcludedForRun(supabaseClient, runId),
  ]);

  const expectedRecordCount = manifest.records.length;
  const expectedExcludedCount = (manifest.excluded || []).length;

  if (recordCount !== expectedRecordCount) {
    throw new SyncVerificationError(`record count mismatch for run ${runId}: Supabase has ${recordCount}, manifest has ${expectedRecordCount}.`);
  }
  if (excludedCount !== expectedExcludedCount) {
    throw new SyncVerificationError(`excluded count mismatch for run ${runId}: Supabase has ${excludedCount}, manifest has ${expectedExcludedCount}.`);
  }

  return { runId, recordCount, excludedCount };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = await import("node:path");
  const { loadManifestFromDisk, createSupabaseServiceClient } = await import("./syncManifestToSupabase.mjs");
  const manifestPath = process.argv[2] || path.join("engineering-brain", "index-manifest.json");
  const manifest = loadManifestFromDisk(manifestPath);
  const supabaseClient = createSupabaseServiceClient();
  verifySync({ supabaseClient, manifest })
    .then((result) => {
      console.log(`Verified run ${result.runId}: ${result.recordCount} records, ${result.excludedCount} excluded -- matches the manifest exactly.`);
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
