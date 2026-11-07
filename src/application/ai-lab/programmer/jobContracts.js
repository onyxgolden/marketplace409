/**
 * Job contracts for the AI Lab programmer dry-run wiring (P5-A).
 *
 * Versioned job descriptor (DATA — never a scheduler registration),
 * the host-owned mode enum, and the job request contract. This slice
 * is contract + private presentation only: it defines the shapes a
 * future P5-B/C/D slice would execute against, and wires nothing to
 * run. The dormant #610 prototype
 * (scripts/ai-agents/programmer-prototype/) is the execution contract
 * this module consumes; it is NOT modified here.
 *
 * Mode is a closed enum: DISABLED or SYNTHETIC_PREVIEW. Production-
 * live execution is unconditionally ACTIVATION_REQUIRED in this
 * release: no request field, environment flag, accepted proposal,
 * relay assertion or UI click can unlock it — there is deliberately
 * no code path that turns a caller-supplied value into a live mode.
 * Real-branch dry runs need Jason's separate explicit authorization
 * (P5 scope brief, gates); this slice runs synthetic fixtures only.
 */
import {
  ALL_PROFILE_IDS,
  BUDGETS,
  POLICY_VERSION,
  PROTOTYPE_VERSION,
} from "../../../../scripts/ai-agents/programmer-prototype/src/constants.mjs";

export const JOB_CONTRACT_VERSION = "programmer-dry-run-job@1";
export const PROPOSAL_SCHEMA_VERSION = "programmer-dry-run-proposal@1";
export const PRIVATE_ITEM_SCHEMA = "programmer-private-item@1";

/**
 * Pins carried from the #610 prototype, re-exported so consumers
 * bind to one version. The numbers are NOT duplicated here: they are
 * imported from the prototype's constants module, and the test suite
 * asserts the pinned values so a silent prototype drift is caught
 * at test time instead of at review time.
 */
export { ALL_PROFILE_IDS, BUDGETS, POLICY_VERSION, PROTOTYPE_VERSION };
export const PROTOTYPE_PIN = Object.freeze({
  policyVersion: POLICY_VERSION,
  prototypeVersion: PROTOTYPE_VERSION,
  budgets: BUDGETS,
});

export const MODES = Object.freeze(["DISABLED", "SYNTHETIC_PREVIEW"]);

export const AGENT = "programmer";

export const JOB_KINDS = Object.freeze({
  PROGRAMMER_DRY_RUN_PROPOSAL: "programmer-dry-run-proposal",
});

/**
 * The one job this slice defines. Readiness is honestly
 * CONTRACT_ONLY: nothing is wired to run, no worktree is created,
 * no test is executed. Do NOT claim WIRED_INERT — that label is
 * earned by an executing slice (P5-B/C), not by a contract.
 */
export const JOB_DESCRIPTORS = Object.freeze([
  Object.freeze({
    job_id: "programmer-dry-run-proposal@1",
    agent: AGENT,
    kind: JOB_KINDS.PROGRAMMER_DRY_RUN_PROPOSAL,
    version: 1,
    proposed_trigger:
      "manual 'Prepare dry run' press in the private Workbench (documentation only — not registered anywhere; no automatic invocation)",
    reporting_window: "one bounded dry-run proposal per explicit trigger",
    window_name: "programmer-dry-run-single-proposal",
    readiness: "CONTRACT_ONLY",
  }),
]);

export class JobRefusal extends Error {
  constructor(code, detail = "") {
    super(detail ? `${code}:${detail}` : code);
    this.name = "JobRefusal";
    this.code = code;
    this.detail = detail;
  }
}

/**
 * Resolve the effective mode for an invocation. `hostMode` comes from
 * the host-owned configuration only. A caller asking for anything
 * live-shaped gets ACTIVATION_REQUIRED; an unrecognized host mode
 * refuses closed.
 */
export function resolveMode(hostMode, callerAsk) {
  if (callerAsk !== undefined && callerAsk !== null && callerAsk !== "preview" && callerAsk !== "default") {
    throw new JobRefusal(
      "ACTIVATION_REQUIRED",
      `caller-requested mode '${String(callerAsk)}' is not available in this release`,
    );
  }
  if (hostMode === undefined || hostMode === null || hostMode === "DISABLED") return "DISABLED";
  if (hostMode === "SYNTHETIC_PREVIEW") return "SYNTHETIC_PREVIEW";
  if (hostMode === "LIVE" || hostMode === "PRODUCTION" || hostMode === "PRODUCTION_LIVE" || hostMode === "REAL_BRANCH") {
    throw new JobRefusal(
      "ACTIVATION_REQUIRED",
      "real-branch dry runs require Jason's separate explicit authorization and a separately reviewed change",
    );
  }
  throw new JobRefusal("UNKNOWN_MODE", String(hostMode));
}

export function descriptorFor(kind) {
  return JOB_DESCRIPTORS.find((d) => d.kind === kind) ?? null;
}

/**
 * Validate a dry-run job request. Identity/scope fields are
 * cross-checked against the host registration by the (future) runner;
 * this validates shape only. Unknown fields refuse — a request can
 * never smuggle a mode, adapter, URL, path, SQL or shell command
 * through extra keys.
 *
 * The repo identity, exact base SHA and task digest are host-bound
 * labels here: a caller string cannot enlarge authorization, and no
 * real-branch run exists in this slice to consume them.
 */
const REQUEST_FIELDS = Object.freeze([
  "principal_ref",
  "operator_ref",
  "repo_ref",
  "job_kind",
  "job_version",
  "base_sha",
  "task_digest",
  "as_of",
  "snapshot_request_id",
]);
const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const UTC_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
export function validateJobRequest(request) {
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    throw new JobRefusal("BAD_REQUEST", "request must be an object");
  }
  for (const key of Object.keys(request)) {
    if (!REQUEST_FIELDS.includes(key)) throw new JobRefusal("BAD_REQUEST", `unknown request field '${key}'`);
  }
  for (const field of ["principal_ref", "operator_ref", "repo_ref", "job_kind", "snapshot_request_id"]) {
    if (typeof request[field] !== "string" || request[field].length === 0) {
      throw new JobRefusal("BAD_REQUEST", `${field} must be a non-empty string`);
    }
  }
  if (request.job_kind !== JOB_KINDS.PROGRAMMER_DRY_RUN_PROPOSAL) {
    throw new JobRefusal("BAD_REQUEST", `job_kind must be ${JOB_KINDS.PROGRAMMER_DRY_RUN_PROPOSAL}`);
  }
  if (request.job_version !== 1) {
    throw new JobRefusal("BAD_REQUEST", "job_version must be 1");
  }
  if (typeof request.base_sha !== "string" || !HEX40.test(request.base_sha)) {
    throw new JobRefusal("BAD_REQUEST", "base_sha must be a full 40-hex Git object id");
  }
  if (typeof request.task_digest !== "string" || !HEX64.test(request.task_digest)) {
    throw new JobRefusal("BAD_REQUEST", "task_digest must be a 64-hex SHA-256 digest");
  }
  if (typeof request.as_of !== "string" || !UTC_INSTANT_RE.test(request.as_of)) {
    throw new JobRefusal("BAD_REQUEST", "as_of must be an explicit UTC instant (Zulu)");
  }
  return request;
}
