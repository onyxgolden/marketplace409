/**
 * harness.js — test helper (loaded only AFTER bootstrap trust verification).
 * Builds the fixed-clock host context from the pinned fixture store and
 * exposes small builders for tasks. Never imported by run-tests.js's
 * pre-verification path.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const CLOCK = "2026-10-14T12:00:00Z";
export const APPROVED_REPOS = ["forge-ai-drop-fixtures"];

export function loadStore() {
  return JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));
}

export function loadBattery() {
  return JSON.parse(readFileSync(join(ROOT, "corpus", "battery.json"), "utf8"));
}

export function makeContext(store) {
  return { clock: CLOCK, fixtureStore: store, approvedRepos: APPROVED_REPOS };
}

export function taskFor(fixtureId, store, requestedAction = "assemble_draft") {
  return {
    task_id: "test-" + fixtureId,
    bundle_refs: [store.fixtures[fixtureId].source_ref],
    period_ids: [],
    requested_action: requestedAction,
  };
}

export function runCase(fixtureId, store, requestedAction) {
  return run(taskFor(fixtureId, store, requestedAction), makeContext(store));
}

export { run };
