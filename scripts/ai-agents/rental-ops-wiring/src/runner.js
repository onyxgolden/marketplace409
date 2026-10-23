import { Worker } from "node:worker_threads";
import {
  Budget, BudgetExceededError, ControlDataError, EXECUTION_BOUNDARY_MS,
} from "../../../../src/application/ai-lab/rental-ops/budgets.js";
import { canonicalJson } from "../../../../src/application/ai-lab/rental-ops/canonical.js";
import {
  JOB_KINDS, JobRefusal, descriptorFor, resolveMode, validateJobRequest,
} from "../../../../src/application/ai-lab/rental-ops/jobContracts.js";
import { buildSnapshot } from "../../../../src/application/ai-lab/rental-ops/snapshotBuilder.js";
import { serializePrivateItem } from "../../../../src/application/ai-lab/rental-ops/privateItemSerializer.js";

/**
 * The inert rental-ops job runner.
 *
 * Host-owned configuration decides everything that matters: the mode,
 * which adapter kind is installed, and the registered principal/owner
 * a request must match. The job request is data — it cannot carry a
 * mode, an adapter, a URL, a path or SQL (unknown fields refuse).
 *
 * Outcomes are explicit and distinct: DISABLED (returned before any
 * adapter, credential, store or source is touched), REFUSED (with a
 * code), BUDGET_EXCEEDED (a named bounded refusal with no domain
 * totals), ACTIVATION_REQUIRED (any live-shaped ask), COMPLETED.
 */
export async function runJob({ hostConfig, request, callerAsk = undefined, callerAdapter = undefined, adapterFactory, publisher, clock, policies = undefined }) {
  const counters = { adapter_opens: 0, adapter_calls: 0, credential_reads: 0, network_calls: 0, store_writes: 0 };
  const done = (outcome, extra = {}) => ({ outcome, counters, ...extra });
  try {
    if (callerAdapter !== undefined) {
      throw new JobRefusal("CALLER_ADAPTER_REFUSED", "callers cannot supply an adapter, URL, path or query");
    }
    const descriptor = descriptorFor(request?.job_kind);
    if (!descriptor) throw new JobRefusal("UNKNOWN_AGENT", `job kind '${String(request?.job_kind)}'`);
    const mode = resolveMode(hostConfig?.mode, callerAsk);
    if (mode === "DISABLED") return done("DISABLED", { mode });
    if (descriptor.kind === JOB_KINDS.MM_BACKLOG_REVIEW) {
      throw new JobRefusal("JOB_NOT_BUILT_IN_SLICE", "Maintenance Manager wiring is P2a-2 and starts only after a GO on P2a-1");
    }
    validateJobRequest(request);
    if (request.principal_ref !== hostConfig.registered_principal) {
      throw new JobRefusal("PRINCIPAL_MISMATCH", "request principal does not match the host registration");
    }
    if (request.owner_ref !== hostConfig.registered_owner) {
      throw new JobRefusal("SCOPE_VIOLATION", "request owner does not match the host-registered owner scope");
    }
    if (hostConfig.adapter_kind !== "synthetic") {
      throw new JobRefusal("ADAPTER_NOT_INSTALLED", "this release installs only the synthetic adapter");
    }
    counters.adapter_opens += 1;
    const adapter = adapterFactory();
    const budget = new Budget();
    try {
      const snapshot = await withBoundary(
        buildSnapshot({ request, adapter, budget, clock }),
        EXECUTION_BOUNDARY_MS,
      );
      counters.adapter_calls = adapter.calls?.length ?? 0;
      const fatal = (snapshot.collection_errors ?? []).find((e) => e.code === "PERMISSION_REVOKED" || e.code === "STALE_SESSION");
      if (fatal) throw new JobRefusal(fatal.code, "the read principal's permission/session is not valid; no report is published");
      const report = await runEvaluator(snapshot, policies, EXECUTION_BOUNDARY_MS);
      const item = serializePrivateItem({ report, snapshot, publishedAt: clock.nowIso() });
      const recordCount = report.sections.lease_expirations.count
        + report.sections.overdue_balances.rows.length
        + report.sections.integrity.count
        + report.recommendations.length + report.escalations.length;
      budget.chargeOutput(recordCount, Buffer.byteLength(canonicalJson(item), "utf8"));
      const receipt = await publisher.publish(item, snapshot);
      if (receipt?.written) counters.store_writes += 1;
      return done("COMPLETED", {
        mode, item_id: item.item_id, report_status: report.status,
        report_digest: item.report_digest, snapshot_digest: snapshot.digest, receipt,
      });
    } finally {
      if (typeof adapter.close === "function") adapter.close();
    }
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return done("BUDGET_EXCEEDED", {
        code: "BUDGET_EXCEEDED", kind: err.kind, limit: err.limit,
        refusal_report: {
          schema: "rental-ops-refusal@1", code: "BUDGET_EXCEEDED", kind: err.kind, limit: err.limit,
          domain_totals: null, execution_authorized: false,
        },
      });
    }
    if (err instanceof ControlDataError) return done("REFUSED", { code: err.code, detail: err.reason });
    if (err instanceof JobRefusal) {
      if (err.code === "ACTIVATION_REQUIRED") return done("ACTIVATION_REQUIRED", { code: err.code, detail: err.detail });
      return done("REFUSED", { code: err.code, detail: err.detail });
    }
    throw err;
  }
}

function withBoundary(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new JobRefusal("EXECUTION_TIMEOUT", `${ms}ms hard boundary`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function runEvaluator(snapshot, policies, ms) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./evaluateWorker.js", import.meta.url), {
      workerData: { snapshot, policies },
    });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new JobRefusal("EXECUTION_TIMEOUT", "evaluator exceeded the hard boundary and was terminated"));
    }, ms);
    worker.once("message", (msg) => {
      clearTimeout(timer);
      worker.terminate();
      if (msg?.ok) resolve(msg.report);
      else reject(new JobRefusal(msg?.code ?? "EVALUATOR_ERROR", msg?.message ?? "evaluator failed"));
    });
    worker.once("error", (err) => { clearTimeout(timer); reject(err); });
  });
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
