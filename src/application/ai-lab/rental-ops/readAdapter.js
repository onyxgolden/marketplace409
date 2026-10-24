import { FIELD_ALLOWLIST, DATASETS, MM_DATASETS } from "./fieldMappings.js";
import { JobRefusal } from "./jobContracts.js";

/**
 * The read boundary. A read adapter is the ONLY way snapshot data
 * enters the job, and it is an injected capability: this release
 * provisions no credentials, reads no environment, builds no SQL and
 * opens no connection. `createDeployableReadAdapter` without an
 * injected authorized capability refuses with ACTIVATION_REQUIRED —
 * the deployable adapter is inert by construction.
 *
 * Adapter contract (implemented by the synthetic repository double in
 * scripts/ai-agents/rental-ops-wiring for this slice):
 *   collect(dataset, { owner_ref, cursor, fields, signal? })
 *     -> Promise<{ rows: object[], next_cursor: string|null,
 *                  revision: string|null, expected_total?: number }>
 *   close() -> void
 * `signal`, when present, is the invocation deadline's AbortSignal —
 * an optional cooperative-cancellation hint; the snapshot builder
 * enforces the deadline whether or not the adapter honors it.
 * The adapter is owner-scoped by the host registration: it may only
 * ever be asked for the request's owner, and the snapshot builder
 * re-checks every admitted row's owner before returning bytes.
 */
export const READ_PROJECTION = Object.freeze(
  Object.fromEntries([...new Set([...DATASETS, ...MM_DATASETS])].map((d) => [d, FIELD_ALLOWLIST[d]])),
);

export function assertAdapterShape(adapter) {
  if (adapter === null || typeof adapter !== "object" || typeof adapter.collect !== "function") {
    throw new JobRefusal("BAD_ADAPTER", "read adapter must expose collect(dataset, pageRequest)");
  }
  return adapter;
}

export function createDeployableReadAdapter({ capability } = {}) {
  if (!capability || typeof capability.readPage !== "function") {
    throw new JobRefusal(
      "ACTIVATION_REQUIRED",
      "no authorized read capability injected; live reads require Jason's activation word, a named read principal and a separately reviewed change",
    );
  }
  return {
    source_system: capability.source_system ?? "authorized-read-capability",
    async collect(dataset, pageRequest) {
      const page = await capability.readPage({
        dataset,
        owner_ref: pageRequest.owner_ref,
        cursor: pageRequest.cursor,
        fields: [...READ_PROJECTION[dataset]],
      });
      if (page === null || typeof page !== "object" || !Array.isArray(page.rows)) {
        throw new JobRefusal("BAD_ADAPTER", `capability returned a malformed page for ${dataset}`);
      }
      return page;
    },
    close() { if (typeof capability.close === "function") capability.close(); },
  };
}
