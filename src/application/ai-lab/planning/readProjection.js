/**
 * The planning read boundary. A read adapter is the ONLY way snapshot
 * data enters the job, and it is an injected capability: this release
 * provisions no credentials, reads no environment, builds no SQL and
 * opens no connection. `createDeployableReadAdapter` without an
 * injected authorized capability refuses with ACTIVATION_REQUIRED —
 * the deployable adapter is inert by construction.
 *
 * Adapter contract (implemented by the synthetic repository double in
 * scripts/ai-agents/planning-wiring for this slice):
 *   collect(dataset, { owner_ref, project_scope, fields, cursor, signal? })
 *     -> Promise<{ rows: object[], next_cursor: string|null,
 *                  revision: string|null, expected_total?: number }>
 *   close() -> void
 * `project_scope` is the request's typed scope {type, id}: the
 * adapter serves only rows inside that scope (like RLS would) —
 * project-scoped rows for the scope project, global calendars only
 * when explicitly authorized (see the snapshot builder's
 * authorizedGlobalRefs check, the defense-in-depth twin).
 * `fields` is the exact allowlisted column list the builder asks
 * for: a query spy asserts every collect call asks only for
 * allowlisted columns and never for a forbidden dataset.
 * `signal`, when present, is the invocation deadline's AbortSignal —
 * an optional cooperative-cancellation hint; the snapshot builder
 * enforces the deadline whether or not the adapter honors it.
 * The adapter is owner- and scope-bound by the host registration:
 * it may only ever be asked for the request's owner and scope, and
 * the snapshot builder re-checks every admitted row's owner and
 * scope before returning bytes.
 *
 * NEVER call through this boundary to the scheduling project GET
 * endpoint, computeAndPersistCpm, persistCpmResults, or any broad
 * application helper that writes derived CPM fields: the GET
 * recomputes and persists CPM data as a side effect, and this lane
 * recomputes from a projection instead of reading a prior engine's
 * outputs. The import graph of this namespace contains no reference
 * to those modules; a battery case greps for them and fails if one
 * appears.
 */
import { FIELD_ALLOWLIST } from "./fieldMappings.js";
import { JobRefusal } from "./jobContracts.js";

export const READ_PROJECTION = Object.freeze(
  Object.fromEntries(Object.keys(FIELD_ALLOWLIST).map((d) => [d, FIELD_ALLOWLIST[d]])),
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
        project_scope: pageRequest.project_scope,
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
