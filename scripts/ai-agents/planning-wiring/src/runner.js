import {
  BudgetExceededError, ControlDataError, admitControlObject, countOutputRecords,
} from "../../../../src/application/ai-lab/rental-ops/budgets.js";
import { canonicalJson } from "../../../../src/application/ai-lab/rental-ops/canonical.js";
import {
  JOB_KINDS, JobRefusal, descriptorFor, resolveMode, validateJobRequest,
} from "../../../../src/application/ai-lab/planning/jobContracts.js";
import { serializePrivateItem } from "../../../../src/application/ai-lab/planning/privateItemSerializer.js";
import { createInvocationDeadline, publishBounded, runExecution } from "../../rental-ops-wiring/src/deadline.js";
import { createPlanningBudget } from "./planningBudget.js";
const EXECUTE_WORKER_URL = new URL("./executeWorker.js", import.meta.url);

/**
 * The inert planning-lane job runner (P2b-1).
 *
 * Host-owned configuration decides everything that matters: the mode,
 * which adapter kind is installed, and the registered
 * principal/owner/project-scope a request must match. The job request
 * is data — it cannot carry a mode, an adapter, a URL, a path, SQL,
 * a calendar or a mapping (unknown fields refuse), and its
 * project_scope_ref is a label until the runner binds it to the
 * host-registered scope (type AND id must match — a scheduling
 * project id is not a package id even when the strings match).
 *
 * ONE invocation budget is created before ANY control object is
 * consulted: the host config, request, policies and adapter spec are
 * admitted through it as primitive-only copies — accessors, proxies
 * and serialization hooks refuse with CONTROL_DATA_REFUSED without
 * ever running. Admission, normalization and evaluation then execute
 * inside the pinned execution worker under ONE preemptive invocation
 * deadline; the main thread enforces it by terminating the worker.
 * Publication is bounded separately (PUBLICATION_TIMEOUT).
 *
 * Shared machinery, not duplicated: the budget primitives, canonical
 * JSON, and the deadline/worker-termination/publication machinery
 * are imported from the P2a modules (the authority/deadline
 * implementations are shared, not copied — only the family-specific
 * dispatch differs: planning contracts, planning snapshot builder,
 * planning evaluator, planning serializer). The worker URL is the
 * planning worker: runExecution's workerUrl parameter exists for
 * exactly this host-side selection, and no request, task or caller
 * can reach it.
 *
 * Outcomes are explicit and distinct: DISABLED (returned before any
 * adapter, credential, store or source is touched), REFUSED (with a
 * code), BUDGET_EXCEEDED (a named bounded refusal with no domain
 * totals), ACTIVATION_REQUIRED (any live-shaped ask), COMPLETED.
 */
export async function runJob({ hostConfig, request, callerAsk = undefined, callerAdapter = undefined, adapterSpec = undefined, publisher, clock, policies = undefined }) {
  const counters = { adapter_opens: 0, adapter_calls: 0, credential_reads: 0, network_calls: 0, store_writes: 0 };
  const done = (outcome, extra = {}) => ({ outcome, counters, ...extra });
  const budget = createPlanningBudget();
  try {
    if (callerAdapter !== undefined) {
      throw new JobRefusal("CALLER_ADAPTER_REFUSED", "callers cannot supply an adapter, URL, path or query");
    }
    if (callerAsk !== undefined && callerAsk !== null && typeof callerAsk !== "string") {
      throw new JobRefusal("BAD_REQUEST", "callerAsk must be a string");
    }
    const host = admitControlObject(hostConfig ?? {}, "host", budget);
    const req = admitControlObject(request, "request", budget);
    const pol = policies === undefined ? undefined : admitControlObject(policies, "policies", budget);
    const spec = adapterSpec === undefined ? undefined : admitControlObject(adapterSpec, "adapterSpec", budget);
    const descriptor = descriptorFor(req?.job_kind);
    if (!descriptor) throw new JobRefusal("UNKNOWN_AGENT", `job kind '${String(req?.job_kind)}'`);
    const mode = resolveMode(host?.mode, callerAsk);
    if (mode === "DISABLED") return done("DISABLED", { mode });
    validateJobRequest(req);
    if (req.principal_ref !== host.registered_principal) {
      throw new JobRefusal("PRINCIPAL_MISMATCH", "request principal does not match the host registration");
    }
    if (req.owner_ref !== host.registered_owner) {
      throw new JobRefusal("SCOPE_VIOLATION", "request owner does not match the host-registered owner scope");
    }
    // Typed scope binding: type AND id must match the host
    // registration. A scope of another type with a coincidentally
    // equal id is not the registered scope.
    const regScope = host.registered_project_scope;
    if (!regScope || typeof regScope !== "object"
      || req.project_scope_ref?.type !== regScope.type || req.project_scope_ref?.id !== regScope.id) {
      throw new JobRefusal("SCOPE_UNREGISTERED", "request project scope is not the host-registered project scope for this owner");
    }
    if (host.adapter_kind !== "synthetic" || spec?.kind !== "synthetic") {
      throw new JobRefusal("ADAPTER_NOT_INSTALLED", "this release installs only the synthetic adapter");
    }
    // P2b-3: the Project Manager job's controls leg is scoped by
    // the host-supplied project mapping, never by the request. The
    // runner binds it before spawning: the mapping must be present,
    // closed-shape, and its scheduling side must be exactly the
    // registered scope. The worker re-validates it in full.
    if (req.job_kind === "project-manager-plan-health-review") {
      const mapping = spec?.project_mapping;
      if (mapping === undefined || mapping === null) {
        throw new JobRefusal("PROJECT_MAPPING_REQUIRED", "no registered project mapping: the composition cannot bind a scheduling project to a work-management project without one");
      }
      if (typeof mapping !== "object" || Array.isArray(mapping)
        || mapping.scheduling_project_ref !== regScope.id
        || typeof mapping.work_management_project_ref !== "string" || mapping.work_management_project_ref.length === 0
        || typeof mapping.mapping_version !== "string" || mapping.mapping_version.length === 0) {
        throw new JobRefusal("BAD_MAPPING", "project mapping must bind its scheduling side to the registered scope with a non-empty work-management side and mapping version");
      }
    }
    const deadline = createInvocationDeadline();
    try {
      const clockIso = clock.nowIso();
      const exec = await runExecution({
        adapterSpec: spec, request: req, policies: pol,
        budgetUsed: budget.used, clockIso, deadline, workerUrl: EXECUTE_WORKER_URL,
      });
      counters.adapter_opens = 1;
      counters.adapter_calls = exec.adapterCalls;
      budget.used = exec.budgetUsed;
      const { snapshot, report } = exec;
      const fatal = (snapshot.collection_errors ?? []).find((e) => e.code === "PERMISSION_REVOKED" || e.code === "STALE_SESSION");
      if (fatal) throw new JobRefusal(fatal.code, "the read principal's permission/session is not valid; no report is published");
      const item = serializePrivateItem({ report, snapshot, publishedAt: clockIso });
      budget.chargeOutput(countOutputRecords(item), Buffer.byteLength(canonicalJson(item), "utf8"));
      const receipt = await publishBounded(publisher, item, snapshot);
      if (receipt?.written) counters.store_writes += 1;
      return done("COMPLETED", {
        mode, item_id: item.item_id, report_status: report.status,
        report_digest: item.report_digest, snapshot_digest: snapshot.digest, receipt,
        adapter_closed: exec.adapterClosed, adapter_datasets: exec.adapterDatasets ?? [],
        item, report, snapshot,
      });
    } finally {
      deadline.dispose();
    }
  } catch (err) {
    if (err instanceof BudgetExceededError || err?.code === "BUDGET_EXCEEDED") {
      const refusal_report = {
        schema: "planning-refusal@1", code: "BUDGET_EXCEEDED", kind: err.kind, limit: err.limit,
        domain_totals: null, execution_authorized: false,
      };
      return done("BUDGET_EXCEEDED", {
        code: "BUDGET_EXCEEDED", kind: err.kind, limit: err.limit, refusal_report,
        refusal_envelope_bytes: Buffer.byteLength(canonicalJson(refusal_report), "utf8"),
      });
    }
    if (err instanceof ControlDataError) return done("REFUSED", { code: err.code, detail: err.reason });
    // Duck-typed, not instanceof: worker-side refusals are
    // reconstituted by the shared deadline module as rental-ops
    // JobRefusals (same codes, different class) — the code string
    // is the contract, not the class identity.
    if (err && typeof err.code === "string") {
      if (err.code === "ACTIVATION_REQUIRED") return done("ACTIVATION_REQUIRED", { code: err.code, detail: err.message ?? err.detail });
      return done("REFUSED", { code: err.code, detail: err.message ?? err.detail });
    }
    throw err;
  }
}

/** In-memory publisher double (tests + battery). Mirrors the private store's publish contract. */
export function createMemoryPublisher() {
  const items = new Map();
  return {
    items,
    async publish(item) {
      const prior = items.get(item.item_id);
      if (prior) {
        if (prior.report_digest !== item.report_digest) {
          throw new JobRefusal("REPUBLISH_CONFLICT", "same item identity with different report bytes");
        }
        return { written: false, idempotent: true, item_id: item.item_id };
      }
      items.set(item.item_id, item);
      return { written: true, idempotent: false, item_id: item.item_id };
    },
  };
}
