/**
 * Job contracts for the AI Lab planning-lane wiring (P2b): versioned job
 * descriptors (DATA — never scheduler registrations), the host-owned
 * mode enum, the closed job request contract, and the mode resolver.
 *
 * Mode is a closed enum: DISABLED or SYNTHETIC_PREVIEW. Production-
 * live execution is unconditionally ACTIVATION_REQUIRED in this
 * release: no request field, environment flag, accepted report, relay
 * assertion or UI click can unlock it — there is deliberately no code
 * path that turns a caller-supplied value into a live mode.
 *
 * Slice order (P2b brief §1): P2b-1 Scheduler → P2b-2 Project Controls
 * → P2b-3 Project Manager, one PR per slice. This slice builds the
 * Scheduler job only. The Controls and Project Manager descriptors
 * ship as data (all three jobs DISABLED per the brief) with readiness
 * NOT_BUILT_P2B2 / NOT_BUILT_P2B3; the execution worker refuses
 * those kinds with JOB_NOT_BUILT_IN_SLICE until their slices land —
 * the same sequencing-gate pattern P2a-1 left for P2a-2.
 *
 * Identity model (brief §4): a scheduling project ID, a
 * work-management project ID, a package ID and a generic project_id
 * are DIFFERENT identity types. The request carries a TYPED project
 * scope ({type, id}); cross-domain association requires an explicit
 * owner-scoped mapping registered by the host — never inferred from
 * equal strings, labels, property links or similar dates. The
 * Scheduler job requires a scheduling-project scope; any other scope
 * type refuses SCOPE_TYPE_MISMATCH before any adapter is opened.
 */

export const JOB_CONTRACT_VERSION = "planning-job@1";

export const MODES = Object.freeze(["DISABLED", "SYNTHETIC_PREVIEW"]);

export const AGENTS = Object.freeze({
  SCHEDULER: "scheduler",
  PROJECT_CONTROLS: "project-controls",
  PROJECT_MANAGER: "project-manager",
});

export const JOB_KINDS = Object.freeze({
  SCHEDULER_PLANNING_REVIEW: "scheduler-planning-review",
  CONTROLS_EVIDENCE_REVIEW: "project-controls-evidence-review",
  PM_PLAN_HEALTH_REVIEW: "project-manager-plan-health-review",
});

/** Typed project-scope types. Only scheduling-project is served by P2b-1. */
export const PROJECT_SCOPE_TYPES = Object.freeze([
  "scheduling-project",
  "work-management-project",
  "package",
  "generic-project",
]);

/**
 * The three P2b jobs. Proposed triggers are documentation only —
 * no workflow, timer, cron, Bridge job or schedule registration
 * ships in this slice (brief §1). The reporting windows are the
 * closed window vocabulary bound to each job (P670-004 lesson: a
 * window registered to another job refuses, never silently rewrites).
 */
export const JOB_DESCRIPTORS = Object.freeze([
  Object.freeze({
    job_id: "scheduler-planning-review@1",
    agent: AGENTS.SCHEDULER,
    kind: JOB_KINDS.SCHEDULER_PLANNING_REVIEW,
    version: 1,
    proposed_trigger: "Monday 08:00 America/Chicago (documentation only — not registered anywhere)",
    reporting_window: "planning lookahead 14 civil days",
    window_name: "planning-lookahead-14-civil-days",
    readiness: "WIRED_INERT",
  }),
  Object.freeze({
    job_id: "project-controls-evidence-review@1",
    agent: AGENTS.PROJECT_CONTROLS,
    kind: JOB_KINDS.CONTROLS_EVIDENCE_REVIEW,
    version: 1,
    proposed_trigger: "Monday 08:15 America/Chicago (documentation only — not registered anywhere)",
    reporting_window: "planning latest through as_of",
    window_name: "planning-latest-through-asof",
    readiness: "NOT_BUILT_P2B2",
  }),
  Object.freeze({
    job_id: "project-manager-plan-health-review@1",
    agent: AGENTS.PROJECT_MANAGER,
    kind: JOB_KINDS.PM_PLAN_HEALTH_REVIEW,
    version: 1,
    proposed_trigger: "Monday 08:30 America/Chicago (documentation only — not registered anywhere)",
    reporting_window: "planning review snapshot",
    window_name: "planning-review-snapshot",
    readiness: "NOT_BUILT_P2B3",
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
    throw new JobRefusal("ACTIVATION_REQUIRED", `caller-requested mode '${String(callerAsk)}' is not available in this release`);
  }
  if (hostMode === undefined || hostMode === null || hostMode === "DISABLED") return "DISABLED";
  if (hostMode === "SYNTHETIC_PREVIEW") return "SYNTHETIC_PREVIEW";
  if (hostMode === "LIVE" || hostMode === "PRODUCTION" || hostMode === "PRODUCTION_LIVE") {
    throw new JobRefusal("ACTIVATION_REQUIRED", "production-live execution requires Jason's activation word and a separately reviewed change");
  }
  throw new JobRefusal("UNKNOWN_MODE", String(hostMode));
}

export function descriptorFor(kind) {
  return JOB_DESCRIPTORS.find((d) => d.kind === kind) ?? null;
}

/**
 * Validate a job request. Identity/scope fields are cross-checked
 * against the host registration by the runner; this validates shape
 * only. Unknown fields refuse — a request can never smuggle a mode,
 * adapter, URL, path, SQL, calendar or mapping through extra keys.
 *
 * The project scope is a TYPED object {type, id}: the type is part
 * of the identity (a scheduling-project id is not a package id even
 * when the strings match). The window must be exactly the window
 * contract bound to the request's job descriptor. as_of must be an
 * explicit UTC calendar instant (Zulu); offset or loose date forms
 * refuse. The review civil date is the UTC date of as_of (brief §7).
 */
const REQUEST_FIELDS = Object.freeze([
  "principal_ref", "owner_ref", "project_scope_ref", "job_kind", "job_version",
  "as_of", "window", "snapshot_request_id",
]);
const REGISTERED_WINDOWS = Object.freeze([
  "planning-lookahead-14-civil-days",
  "planning-latest-through-asof",
  "planning-review-snapshot",
]);
const UTC_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
export function validateJobRequest(request) {
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    throw new JobRefusal("BAD_REQUEST", "request must be an object");
  }
  for (const key of Object.keys(request)) {
    if (!REQUEST_FIELDS.includes(key)) throw new JobRefusal("BAD_REQUEST", `unknown request field '${key}'`);
  }
  for (const field of ["principal_ref", "owner_ref", "snapshot_request_id"]) {
    if (typeof request[field] !== "string" || request[field].length === 0) {
      throw new JobRefusal("BAD_REQUEST", `${field} must be a non-empty string`);
    }
  }
  const scope = request.project_scope_ref;
  if (scope === null || typeof scope !== "object" || Array.isArray(scope)) {
    throw new JobRefusal("BAD_REQUEST", "project_scope_ref must be an object {type, id}");
  }
  const scopeKeys = Object.keys(scope);
  if (scopeKeys.length !== 2 || !scopeKeys.includes("type") || !scopeKeys.includes("id")) {
    throw new JobRefusal("BAD_REQUEST", "project_scope_ref must be exactly {type, id}");
  }
  if (!PROJECT_SCOPE_TYPES.includes(scope.type)) {
    throw new JobRefusal("BAD_REQUEST", `project_scope_ref.type must be one of ${PROJECT_SCOPE_TYPES.join(", ")}`);
  }
  if (typeof scope.id !== "string" || scope.id.length === 0) {
    throw new JobRefusal("BAD_REQUEST", "project_scope_ref.id must be a non-empty string");
  }
  const descriptor = descriptorFor(request.job_kind);
  if (!descriptor) throw new JobRefusal("UNKNOWN_AGENT", `job kind '${request.job_kind}'`);
  if (request.job_version !== descriptor.version) {
    throw new JobRefusal("BAD_REQUEST", "job_version does not match the registered descriptor");
  }
  if (typeof request.as_of !== "string" || !UTC_INSTANT_RE.test(request.as_of)
    || Number.isNaN(Date.parse(request.as_of))) {
    throw new JobRefusal("BAD_REQUEST", "as_of must be an explicit UTC instant (Zulu, e.g. 2026-10-24T14:00:00.000Z)");
  }
  const w = request.window;
  if (w === null || typeof w !== "object" || Array.isArray(w)) {
    throw new JobRefusal("BAD_REQUEST", "window must be an object");
  }
  const wKeys = Object.keys(w);
  if (wKeys.length !== 1 || wKeys[0] !== "name" || !REGISTERED_WINDOWS.includes(w.name)) {
    throw new JobRefusal("BAD_REQUEST", `window must be exactly { name: '${REGISTERED_WINDOWS.join("' | '")}' } — no caller-supplied horizon or extra fields`);
  }
  if (w.name !== descriptor.window_name) {
    throw new JobRefusal("BAD_REQUEST", `window '${w.name}' is not the registered window for job kind '${request.job_kind}' (expected '${descriptor.window_name}')`);
  }
  return request;
}

/**
 * The Scheduler job serves scheduling-project scopes only. A
 * work-management project, package or generic project scope is a
 * different identity type: no host mapping is registered in P2b-1,
 * so combined conclusions would be UNVERIFIABLE — the job refuses
 * before any adapter is opened rather than serving the wrong
 * population under a matched string.
 */
export function requireSchedulerScope(request) {
  if (request.project_scope_ref?.type !== "scheduling-project") {
    throw new JobRefusal(
      "SCOPE_TYPE_MISMATCH",
      `scheduler-planning-review requires a scheduling-project scope, not '${String(request.project_scope_ref?.type)}'; cross-domain association requires an explicit host-registered mapping`,
    );
  }
}
