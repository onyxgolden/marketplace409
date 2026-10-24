/**
 * Job contracts for the AI Lab rental-ops wiring: versioned job
 * descriptors (DATA — never scheduler registrations), the host-owned
 * mode enum, the job request contract, and the escalation policy
 * registry the Property Manager evaluator derives its review rows
 * from.
 *
 * Mode is a closed enum: DISABLED or SYNTHETIC_PREVIEW. Production-
 * live execution is unconditionally ACTIVATION_REQUIRED in this
 * release: no request field, environment flag, accepted report, relay
 * assertion or UI click can unlock it — there is deliberately no code
 * path that turns a caller-supplied value into a live mode.
 */
export const JOB_CONTRACT_VERSION = "rental-ops-job@1";

export const MODES = Object.freeze(["DISABLED", "SYNTHETIC_PREVIEW"]);

export const AGENTS = Object.freeze({
  PROPERTY_MANAGER: "property-manager",
  MAINTENANCE_MANAGER: "maintenance-manager",
});

export const JOB_KINDS = Object.freeze({
  PM_DAILY_EXCEPTION_REVIEW: "property-manager-daily-exception-review",
  MM_BACKLOG_REVIEW: "maintenance-manager-backlog-review",
});

/**
 * The two jobs built across slices P2a-1 and P2a-2. P2a-1 built the
 * Property Manager daily exception review plus the shared boundary
 * (read adapter, private Workbench item transport, inert job runner);
 * P2a-2 builds the Maintenance Manager backlog review, reusing them.
 */
export const JOB_DESCRIPTORS = Object.freeze([
  Object.freeze({
    job_id: "property-manager-daily-exception-review@1",
    agent: AGENTS.PROPERTY_MANAGER,
    kind: JOB_KINDS.PM_DAILY_EXCEPTION_REVIEW,
    version: 1,
    proposed_trigger: "daily 09:00 America/Chicago (documentation only — not registered anywhere)",
    reporting_window: "lease-expiration horizon 60 days",
    window_name: "lease-expiration-60d",
    readiness: "WIRED_INERT",
  }),
  Object.freeze({
    job_id: "maintenance-manager-backlog-review@1",
    agent: AGENTS.MAINTENANCE_MANAGER,
    kind: JOB_KINDS.MM_BACKLOG_REVIEW,
    version: 1,
    proposed_trigger: "daily 09:15 America/Chicago (documentation only — not registered anywhere)",
    reporting_window: "open backlog, civil UTC day aging",
    window_name: "maintenance-backlog-open",
    readiness: "WIRED_INERT",
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
 * against the host-registered principal AND portfolio by the runner;
 * this validates shape only. Unknown fields refuse — a request can
 * never smuggle a mode, adapter, URL, path or SQL through extra keys.
 *
 * The portfolio and the reporting window are caller LABELS only until
 * the runner binds them: portfolio_ref must equal the host-registered
 * portfolio, and the window must be exactly the window contract bound
 * to the request's job descriptor — a window registered to the OTHER
 * job is not valid authority for this one and refuses here, before
 * any adapter is opened; no caller-supplied horizon, no extra nested
 * fields, and no silent substitution of the job's own window.
 * as_of must be an explicit UTC calendar instant (Zulu); offset or
 * loose date forms refuse.
 */
const REQUEST_FIELDS = Object.freeze([
  "principal_ref", "owner_ref", "portfolio_ref", "job_kind", "job_version",
  "as_of", "window", "snapshot_request_id",
]);
const REGISTERED_WINDOWS = Object.freeze(["lease-expiration-60d", "maintenance-backlog-open"]);
const UTC_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
export function validateJobRequest(request) {
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    throw new JobRefusal("BAD_REQUEST", "request must be an object");
  }
  for (const key of Object.keys(request)) {
    if (!REQUEST_FIELDS.includes(key)) throw new JobRefusal("BAD_REQUEST", `unknown request field '${key}'`);
  }
  for (const field of ["principal_ref", "owner_ref", "portfolio_ref", "job_kind", "snapshot_request_id"]) {
    if (typeof request[field] !== "string" || request[field].length === 0) {
      throw new JobRefusal("BAD_REQUEST", `${field} must be a non-empty string`);
    }
  }
  const descriptor = descriptorFor(request.job_kind);
  if (!descriptor) throw new JobRefusal("UNKNOWN_AGENT", `job kind '${request.job_kind}'`);
  if (request.job_version !== descriptor.version) {
    throw new JobRefusal("BAD_REQUEST", "job_version does not match the registered descriptor");
  }
  if (typeof request.as_of !== "string" || !UTC_INSTANT_RE.test(request.as_of)
    || Number.isNaN(Date.parse(request.as_of))) {
    throw new JobRefusal("BAD_REQUEST", "as_of must be an explicit UTC instant (Zulu, e.g. 2026-10-22T14:00:00.000Z)");
  }
  const w = request.window;
  if (w === null || typeof w !== "object" || Array.isArray(w)) {
    throw new JobRefusal("BAD_REQUEST", "window must be an object");
  }
  const wKeys = Object.keys(w);
  if (wKeys.length !== 1 || wKeys[0] !== "name" || !REGISTERED_WINDOWS.includes(w.name)) {
    throw new JobRefusal("BAD_REQUEST", `window must be exactly { name: '${REGISTERED_WINDOWS.join("' | '")}' } — no caller-supplied horizon or extra fields`);
  }
  // P670-004: the window vocabulary is bound to the job. A window
  // registered to another job refuses here — validateJobRequest runs
  // in the runner before any adapter is opened — instead of being
  // silently rewritten to the job's own window downstream.
  if (w.name !== descriptor.window_name) {
    throw new JobRefusal("BAD_REQUEST", `window '${w.name}' is not the registered window for job kind '${request.job_kind}' (expected '${descriptor.window_name}')`);
  }
  return request;
}

/**
 * Escalation policy registry (versioned job data). Mirrors the
 * reviewed Property Manager prototype's escalation policy shape: every
 * tenant/money/legal touchpoint requires an escalation record, the
 * agent is never the executor, and execution is never authorized for
 * the agent. If a touchpoint has no policy entry, the evaluator BLOCKS
 * the affected recommendation instead of inventing authority.
 */
export const ESCALATION_POLICY_VERSION = "rental-ops-escalation@1";
export const ESCALATION_POLICIES = Object.freeze({
  tenant: Object.freeze({
    touchpoint: "tenant",
    required_authorizer: "jason",
    executor: "property-operator-after-authorization",
    condition: "lease decision affecting a tenancy requires human review before any tenant-facing step",
  }),
  money: Object.freeze({
    touchpoint: "money",
    required_authorizer: "jason",
    executor: "property-operator-after-authorization",
    condition: "overdue balance requires human review; the agent never collects, waives or posts",
  }),
  legal: Object.freeze({
    touchpoint: "legal",
    required_authorizer: "qualified-reviewer",
    executor: "qualified-reviewer",
    condition: "structured legal-process flag present; routed to a qualified reviewer — the agent makes no legal determination",
  }),
});
