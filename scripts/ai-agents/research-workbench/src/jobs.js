/**
 * jobs.js — the P1-C disabled job registry.
 *
 * A Research job definition is operator-authored JSON in a jobs
 * directory that lives OUTSIDE Git (next to the private state
 * directory, never inside a repository). The host loads the files at
 * startup, validates each one through the P1-A contract, and refuses
 * the whole registry unless every definition is DISABLED and scoped
 * to the host principal. There is no second store here: definitions
 * are files the operator owns, and the published preview item in the
 * private store is the single source of truth for a run.
 *
 * The seeded demo definition (fixtures/generac-weekly-brief.json)
 * mirrors the P1-B test definition: the 8-item synthetic Generac
 * replay. Its scope is the demo principal op-1/ws-1; a real operator
 * copies the fixture and sets their own operator_ref/workspace_ref —
 * a scope mismatch refuses at load, fail-closed.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateJobDefinition } from "../../research-job-contract/src/jobDefinition.js";
import { CODES, refuse } from "./errors.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const P1A_FIXTURES = join(HERE, "..", "..", "research-job-contract", "fixtures");

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertPrincipal(principal) {
  if (!isPlainObject(principal)
    || typeof principal.operator_ref !== "string" || principal.operator_ref.length === 0
    || typeof principal.workspace_ref !== "string" || principal.workspace_ref.length === 0) {
    refuse(CODES.BAD_HOST_CONFIG, "host principal must carry non-empty operator_ref and workspace_ref");
  }
  return principal;
}

/**
 * Load every *.json definition in `jobsDir`, validate it, and require
 * DISABLED status + host-principal scope. Returns a frozen array
 * sorted by job_id. Any bad file refuses the whole registry — a
 * half-loaded job list would silently hide a job the operator
 * believes is registered.
 */
export function loadJobDefinitions(jobsDir, principal) {
  assertPrincipal(principal);
  if (typeof jobsDir !== "string" || jobsDir.length === 0) {
    refuse(CODES.JOB_DEFINITIONS_UNAVAILABLE, "a jobs directory is required");
  }
  let names;
  try {
    names = readdirSync(jobsDir).filter((n) => n.endsWith(".json")).sort();
  } catch {
    refuse(CODES.JOB_DEFINITIONS_UNAVAILABLE, `cannot read jobs directory '${jobsDir}'`);
  }
  const seen = new Set();
  const jobs = [];
  for (const name of names) {
    let raw;
    try {
      raw = readFileSync(join(jobsDir, name), "utf8");
    } catch {
      refuse(CODES.JOB_DEFINITIONS_UNAVAILABLE, `cannot read job file '${name}'`);
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      refuse(CODES.BAD_JOB_DEFINITION, `job file '${name}' is not valid JSON`);
    }
    let def;
    try {
      def = validateJobDefinition(parsed);
    } catch (e) {
      refuse(CODES.BAD_JOB_DEFINITION, `job file '${name}': ${e.code ?? e.message}`);
    }
    if (def.status !== "DISABLED") {
      refuse(CODES.BAD_JOB_DEFINITION, `job file '${name}': status must be 'DISABLED', got '${def.status}'`);
    }
    if (def.operator_scope.operator_ref !== principal.operator_ref
      || def.operator_scope.workspace_ref !== principal.workspace_ref) {
      refuse(CODES.BAD_JOB_DEFINITION, `job file '${name}': operator_scope does not match the host principal`);
    }
    if (seen.has(def.job_id)) {
      refuse(CODES.BAD_JOB_DEFINITION, `duplicate job_id '${def.job_id}' in jobs directory`);
    }
    seen.add(def.job_id);
    jobs.push(def);
  }
  jobs.sort((a, b) => (a.job_id < b.job_id ? -1 : a.job_id > b.job_id ? 1 : 0));
  return Object.freeze(jobs);
}

/** The bundled demo definition (validated). Scope is the demo principal op-1/ws-1. */
export function generacDemoDefinition() {
  const raw = readFileSync(join(HERE, "..", "fixtures", "generac-weekly-brief.json"), "utf8");
  return validateJobDefinition(JSON.parse(raw));
}

/** Load one P1-A fixture corpus by file name (synthetic-replay.json etc.). */
export function loadFixtureCorpus(fileName) {
  if (typeof fileName !== "string" || !/^[a-z0-9][a-z0-9-]*\.json$/.test(fileName)) {
    refuse(CODES.BAD_JOB_DEFINITION, "fixture file name must be a lowercase slug ending in .json");
  }
  const raw = readFileSync(join(P1A_FIXTURES, fileName), "utf8");
  return JSON.parse(raw);
}

/** The 8-item synthetic Generac replay corpus (P1-A fixture). */
export function generacReplayCorpus() {
  return loadFixtureCorpus("synthetic-replay.json");
}
