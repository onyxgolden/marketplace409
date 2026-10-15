/**
 * markdown.test.js — the audit preview is inert and clearly marked.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/index.js";
import { renderAuditPreview } from "../src/markdown.js";
import { buildContext } from "./harness.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("audit preview is marked synthetic/advisory/no-authorization and inert", () => {
  const context = buildContext(ROOT, { contextOverrides: null });
  const h = context.heads.find((x) => x.resource_id === "pr:707");
  const task = {
    request_id: "gov-md-1",
    requested_action: "classify",
    actor_ref: "principal:claude",
    action_type: "merge",
    target: {
      repo: "onyxgolden/marketplace409",
      resource_id: "pr:707",
      resource_class: "pr",
      scope_ids: ["scope:release-cadence"],
      head: h.head,
      source_ref: JSON.parse(JSON.stringify(h.source_ref)),
    },
    payload_context: { evidence_record_ids: [] },
  };
  const result = run(task, context);
  assert.equal(result.classification, "ALLOWED");
  const md = renderAuditPreview(result);
  assert.ok(md.includes("SYNTHETIC / ADVISORY / NO AUTHORIZATION"), "banner must mark the preview");
  assert.ok(md.includes("authorization_granted: `false`"), "preview shows no authorization granted");
  assert.ok(md.includes("execution_performed: `false`"), "preview shows no execution performed");
  assert.ok(md.includes("req:reviewer-go"), "preview lists satisfied requirements");
  assert.ok(!/approve|authorized to|permission granted/i.test(md.replace(/NO AUTHORIZATION/g, "")), "preview grants nothing");
});
