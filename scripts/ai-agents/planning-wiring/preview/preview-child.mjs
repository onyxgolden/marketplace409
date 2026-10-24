/**
 * Planning preview child — the authenticated candidate entry for a
 * single synthetic Scheduler preview run.
 *
 * This file is evaluated ONLY after the host-owned trusted launcher
 * (drop repo: tools/trusted-launcher/launch.mjs) has authenticated
 * the entire planning closure against the host trust root — it is
 * never invoked directly. Its static imports are all manifest-pinned
 * candidate modules; the drop repo's private-store.mjs is
 * host-trusted code and is imported dynamically, after the
 * launcher's authentication, from the --drop-root the host supplies
 * (it is not part of the candidate closure and is not pinned).
 *
 * The planning state directory is SEPARATE from the rental-ops
 * private state: it rides FORGE_PLANNING_STATE_DIR (never
 * FORGE_PRIVATE_STATE_DIR, never a fixture directory, never Git).
 * Missing configuration refuses; there is no fallback.
 *
 * Usage (via the launcher):
 *   launch.mjs --wiring-root <planning-wiring> --entry preview/preview-child.mjs -- \
 *     --drop-root <drop repo>
 *
 * Prints a one-line JSON receipt on stdout.
 */
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WIRING = join(HERE, "..");

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

export async function main(argv = []) {
  const dropRoot = arg("drop-root");
  if (!dropRoot) {
    console.error("required: --drop-root <drop repo>");
    return 2;
  }
  const stateDir = process.env.FORGE_PLANNING_STATE_DIR;
  if (!stateDir) {
    console.error("required: FORGE_PLANNING_STATE_DIR (separate planning state directory; no fallback)");
    return 2;
  }
  // Host-trusted code, imported dynamically AFTER the launcher's
  // authentication. Never statically imported: the candidate
  // closure's manifest pins candidate modules only.
  const { openPrivateStore } = await import(
    pathToFileURL(join(dropRoot, "tools", "agent-workbench", "private-store.mjs")).href
  );
  const { runJob } = await import(pathToFileURL(join(WIRING, "src", "runner.js")).href);
  const { CANONICAL_HOST, canonicalRequest, canonicalSpec } = await import(
    pathToFileURL(join(WIRING, "src", "fixtures.js")).href
  );
  const { canonicalDigest } = await import(
    pathToFileURL(join(WIRING, "..", "..", "..", "src", "application", "ai-lab", "rental-ops", "canonical.js")).href
  );
  const store = await openPrivateStore({ stateDir, dropRoot });
  const publisher = {
    async publish(item, snapshot) {
      const itemReceipt = await store.putItem(item);
      const { digest, records, evidence, ...envelope } = snapshot;
      await store.putSnapshot(digest, { ...envelope, digest, records, evidence });
      return { ...itemReceipt, snapshot_digest: digest };
    },
  };
  const clock = { nowIso: () => "2026-10-26T12:00:00.000Z" };
  const result = await runJob({
    hostConfig: CANONICAL_HOST, request: canonicalRequest(),
    adapterSpec: canonicalSpec(), publisher, clock,
  });
  if (result.outcome !== "COMPLETED") {
    console.error(`preview job did not complete: ${result.outcome} ${result.code ?? ""}`);
    return 1;
  }
  // Read-back verification through the store: the stored item's
  // report digest must recompute, and the stored snapshot's digest
  // must recompute over the admitted bytes.
  const storedItem = await store.getItem(result.item_id);
  if (!storedItem || storedItem.report_digest !== result.report_digest) {
    console.error("read-back verification failed: stored item digest mismatch");
    return 1;
  }
  const storedSnapshot = await store.getSnapshot(result.snapshot_digest);
  if (!storedSnapshot) {
    console.error("read-back verification failed: stored snapshot missing");
    return 1;
  }
  const { digest, records, evidence, ...envelope } = storedSnapshot;
  if (canonicalDigest({ envelope, records }) !== digest) {
    console.error("read-back verification failed: stored snapshot digest mismatch");
    return 1;
  }
  console.log(JSON.stringify({
    ok: true, item_id: result.item_id, report_digest: result.report_digest,
    snapshot_digest: result.snapshot_digest, report_status: storedItem.report.status,
  }));
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main(process.argv.slice(2));
}
