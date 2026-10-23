#!/usr/bin/env node
/**
 * Inert rental-ops job CLI — the manual, host-operated entrypoint.
 *
 *   RENTAL_OPS_TRUST_ROOT=<sha256 of runner/manifest.json> \
 *     node runner/trust-entry.mjs --entry runner/run-job.mjs \
 *       -- --config <host-config.json> --request <job-request.json>
 *
 * Trust note (P666-004A): this file performs NO trust check itself
 * and MUST NOT be invoked directly — runner/trust-entry.mjs
 * authenticates the whole closure against the host trust root before
 * this module is imported.
 *
 * The host config (mode, adapter kind, registered principal/owner,
 * synthetic repository ID) is operator-owned; the job request is
 * data. Exit codes keep intentional states visibly distinct:
 *   0 COMPLETED · 10 DISABLED · 11 ACTIVATION_REQUIRED ·
 *   12 REFUSED · 13 BUDGET_EXCEEDED · 3 trust authentication failed
 * The publisher is in-memory: this CLI proves the inert path runs; it
 * persists nothing. (The Workbench preview harness in forge-ai-drop
 * supplies the real private-store publisher.)
 */
import { readFileSync } from "node:fs";

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const configPath = arg("config");
const requestPath = arg("request");
if (!configPath || !requestPath) {
  console.error("required: --config <host-config.json> --request <job-request.json>");
  process.exit(2);
}
const hostConfig = JSON.parse(readFileSync(configPath, "utf8"));
const request = JSON.parse(readFileSync(requestPath, "utf8"));

const { runJob, createMemoryPublisher } = await import("../src/runner.js");
const { SYNTHETIC_REPOSITORIES } = await import("../fixtures/repositories.js");

const repoFactory = SYNTHETIC_REPOSITORIES[hostConfig.repository];
if (!repoFactory) {
  console.error(`unknown synthetic repository '${String(hostConfig.repository)}' (closed registry)`);
  process.exit(2);
}
const clock = { nowIso: () => hostConfig.clock_iso ?? new Date().toISOString() };
const result = await runJob({
  hostConfig,
  request,
  adapterSpec: { kind: "synthetic", datasets: repoFactory(), faults: hostConfig.faults ?? {} },
  publisher: createMemoryPublisher(),
  clock,
});
console.log(JSON.stringify(result, null, 2));
process.exit({ COMPLETED: 0, DISABLED: 10, ACTIVATION_REQUIRED: 11, REFUSED: 12, BUDGET_EXCEEDED: 13 }[result.outcome] ?? 1);
