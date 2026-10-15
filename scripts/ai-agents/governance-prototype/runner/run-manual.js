#!/usr/bin/env node
/**
 * run-manual.js — standalone manual fixture runner for the governance
 * prototype. Manual runs only: loads the fixtures, evaluates one
 * hypothetical action, prints the JSON result plus the inert audit
 * preview. Not part of the scored path.
 *
 * Usage:
 *   node runner/run-manual.js <action_type> <resource_id> <actor_ref> [--scope s1,s2] [--evidence id1,id2] [--as-of <iso>] [--md]
 *
 * Example:
 *   node runner/run-manual.js merge pr:707 principal:claude
 *   node runner/run-manual.js deploy svc:forge-web principal:muse --scope scope:forge-web --md
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/index.js";
import { renderAuditPreview } from "../src/markdown.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));
const values = JSON.parse(readFileSync(join(ROOT, "fixtures", "values.json"), "utf8"));

const args = process.argv.slice(2);
const [action_type, resource_id, actor_ref] = args;
if (!action_type || !resource_id || !actor_ref) {
  console.error("usage: node runner/run-manual.js <action_type> <resource_id> <actor_ref> [--scope s1,s2] [--evidence id1,id2] [--as-of <iso>] [--md]");
  process.exit(2);
}
const opt = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};
const scopeArg = opt("--scope");
const evidenceArg = opt("--evidence");
const asOfArg = opt("--as-of");

const head = store.heads.find((h) => h.resource_id === resource_id);
if (!head) {
  console.error(`unknown fixture resource_id '${resource_id}'`);
  process.exit(2);
}
// resource_class is the prefix before ':' in the fixture resource id.
const resource_class = resource_id.includes(":") ? resource_id.split(":")[0] : resource_id;

const context = {
  clock: asOfArg ? Date.parse(asOfArg) : values.clock,
  principals: store.principals,
  policies: store.policies,
  registrations: store.registrations,
  verdicts: store.verdicts,
  agreements: store.agreements,
  relays: store.relays,
  heads: store.heads,
  readGrants: store.readGrants,
  blobs: store.blobs,
  evidence: store.evidence,
};

const result = run(
  {
    request_id: `manual-${Date.now()}`,
    requested_action: "classify",
    actor_ref,
    action_type,
    target: {
      repo: values.repo,
      resource_id,
      resource_class,
      scope_ids: scopeArg ? scopeArg.split(",") : ["scope:release-cadence"],
      head: head.head,
      source_ref: head.source_ref,
    },
    payload_context: { evidence_record_ids: evidenceArg ? evidenceArg.split(",") : [] },
  },
  context
);
console.log(JSON.stringify(result, null, 2));
if (args.includes("--md")) {
  console.log("\n--- audit preview ---\n");
  console.log(renderAuditPreview(result));
}
