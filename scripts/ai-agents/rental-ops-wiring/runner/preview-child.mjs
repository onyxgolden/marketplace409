#!/usr/bin/env node
/**
 * preview-child.mjs — the authenticated candidate entry for a single
 * synthetic Property Manager preview run.
 *
 * This file is evaluated ONLY after the host-owned trusted launcher
 * (drop repo: tools/trusted-launcher/launch.mjs) has authenticated
 * the entire wiring closure against the host trust root — it is never
 * invoked directly. Its static imports are all manifest-pinned
 * candidate modules; the drop repo's private-store.mjs is
 * host-trusted code and is imported dynamically, after the
 * launcher's authentication, from the --drop-root the host supplies
 * (it is not part of the candidate closure and is not pinned).
 *
 * Usage (via the launcher):
 *   launch.mjs --wiring-root <wiring> --entry runner/preview-child.mjs -- \
 *     --drop-root <drop repo> [--repository preview-basic] [--owner owner-a]
 *
 * Prints a one-line JSON receipt on stdout. FORGE_PRIVATE_STATE_DIR
 * rides the environment.
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
const dropRoot = arg("drop-root");
const repository = arg("repository", "preview-basic");
const owner = arg("owner", "owner-a");
if (!dropRoot) { console.error("required: --drop-root <drop repo>"); process.exit(2); }
const stateDir = process.env.FORGE_PRIVATE_STATE_DIR;
if (!stateDir) { console.error("required: FORGE_PRIVATE_STATE_DIR"); process.exit(2); }

// Host-trusted code, imported dynamically AFTER the launcher's
// authentication. Never statically imported: the candidate closure's
// manifest pins candidate modules only.
const { openPrivateStore } = await import(
  pathToFileURL(join(dropRoot, "tools", "agent-workbench", "private-store.mjs")).href
);
const { runJob } = await import(pathToFileURL(join(WIRING, "src", "runner.js")).href);
const { SYNTHETIC_REPOSITORIES } = await import(pathToFileURL(join(WIRING, "fixtures", "repositories.js")).href);
const { canonicalDigest } = await import(
  pathToFileURL(join(WIRING, "..", "..", "..", "src", "application", "ai-lab", "rental-ops", "canonical.js")).href
);

const repoFactory = SYNTHETIC_REPOSITORIES[repository];
if (!repoFactory) { console.error(`unknown synthetic repository '${repository}' (closed registry)`); process.exit(2); }

const store = await openPrivateStore({ stateDir, dropRoot });
const publisher = {
  async publish(item, snapshot) {
    const itemReceipt = await store.putItem(item);
    // Retain the admitted snapshot under its digest (raw normalized
    // snapshots are the 24h-retention class in the activation
    // runbook). Records/evidence only — synthetic in this slice.
    const { digest, records, evidence, ...envelope } = snapshot;
    await store.putSnapshot(digest, { ...envelope, digest, records, evidence });
    return { ...itemReceipt, snapshot_digest: digest };
  },
};

const hostConfig = {
  mode: "SYNTHETIC_PREVIEW", adapter_kind: "synthetic",
  registered_principal: "host:workbench-operator", registered_owner: owner,
  registered_portfolio: `portfolio-${owner}`,
};
const request = {
  principal_ref: "host:workbench-operator", owner_ref: owner, portfolio_ref: `portfolio-${owner}`,
  job_kind: "property-manager-daily-exception-review", job_version: 1,
  as_of: "2026-10-22T14:00:00.000Z", window: { name: "lease-expiration-60d" },
  snapshot_request_id: `snap-preview-${repository}-${owner}`,
};
const clock = { nowIso: () => "2026-10-22T13:55:00.000Z" };
const result = await runJob({
  hostConfig, request,
  adapterSpec: { kind: "synthetic", datasets: repoFactory() },
  publisher, clock,
});
if (result.outcome !== "COMPLETED") {
  console.log(JSON.stringify({ ok: false, ...result }));
  process.exit(1);
}
// Read-back verification: the stored item's report digest must match
// its report bytes, and the item must be served from the private
// store (not from Git).
const stored = await store.getItem(result.item_id);
const digestOk = stored && canonicalDigest(stored.report) === stored.report_digest;
console.log(JSON.stringify({
  ok: true, item_id: result.item_id, report_status: result.report_status,
  report_digest: result.report_digest, snapshot_digest: result.snapshot_digest,
  stored_digest_verified: digestOk, counters: result.counters,
}));
process.exit(digestOk ? 0 : 1);
