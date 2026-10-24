/**
 * Synthetic repository adapter for the planning lane — the ONLY
 * adapter installed in this release. It serves invented rows from
 * memory, scoped the way the future authorized read capability will
 * be (rows are filtered to the requested owner AND project scope,
 * like RLS would), paged, with declarative fault injection for the
 * coverage battery. It contains no credentials, no network, no SQL
 * and no filesystem access.
 *
 * Scope filtering (mirrors the RLS the future live adapter will
 * enforce):
 * - schedule_projects: only the scope project row.
 * - schedule_lanes / schedule_blocks / schedule_blackout_windows:
 *   rows whose project_ref equals the scope project id.
 * - schedule_calendars: rows whose project_ref equals the scope
 *   project id, PLUS global calendars (project_ref null) whose
 *   calendar_ref is in the spec's authorized_global_calendar_refs.
 *   An unauthorized global calendar is never served — blocks that
 *   resolve to it get MISSING_CALENDAR, never its mask.
 * - schedule_calendar_holidays: rows whose calendar_ref is a served
 *   calendar (project or authorized global).
 * - schedule_dependencies: ties touching the admitted project's
 *   blocks in EITHER direction (predecessor or successor in the
 *   block set) — the app's assembly only fetches by predecessor,
 *   which misses successor-side ties; this adapter does not repeat
 *   that gap.
 *
 * Fault knobs (test-only, set by the harness — never by a job
 * request): failDataset, leakyOwners (return every owner's rows),
 * leakyScope (return every project's rows), blockedDataset (a page
 * read that never settles), pageSize, mixedRevisions, revoked,
 * staleSession, getterCanaryDataset, proxyRowDataset,
 * cyclicRowDataset, cursorLoopDataset, hideExpected, slowReadMs
 * (async sleep before every page read), syncSpinMs (synchronous
 * busy-loop before every page read — proves the execution boundary
 * is preemptive), hangCollect (collect never settles).
 */
export function createSyntheticAdapter({ datasets, faults = {}, authorizedGlobalCalendarRefs = [] }) {
  const calls = [];
  let closed = false;
  const authorizedGlobals = new Set(authorizedGlobalCalendarRefs);
  return {
    source_system: "synthetic-repository",
    calls,
    get closed() { return closed; },
    async collect(dataset, { owner_ref, project_scope, cursor }) {
      calls.push({ dataset, owner_ref, project_scope, cursor });
      if (faults.revoked) throw Object.assign(new Error("permission revoked"), { code: "PERMISSION_REVOKED" });
      if (faults.staleSession) throw Object.assign(new Error("stale session"), { code: "STALE_SESSION" });
      if (faults.failDataset === dataset) throw Object.assign(new Error("source down"), { code: "SOURCE_DOWN" });
      if (faults.hangCollect) return new Promise(() => {});
      if (faults.blockedDataset === dataset) return new Promise(() => {});
      if (typeof faults.slowReadMs === "number" && faults.slowReadMs > 0) {
        await new Promise((r) => setTimeout(r, faults.slowReadMs));
      }
      if (typeof faults.syncSpinMs === "number" && faults.syncSpinMs > 0) {
        const end = Date.now() + faults.syncSpinMs;
        while (Date.now() < end) { /* synchronous runaway: only a preemptive boundary can stop this */ }
      }
      const pageSize = faults.pageSize ?? 100;
      const scopeId = project_scope?.id ?? null;
      const all = datasets[dataset] ?? [];
      let served = all.filter((r) => faults.leakyOwners || r === null || typeof r !== "object" || r.owner_ref === owner_ref);
      if (!faults.leakyScope) {
        if (dataset === "schedule_projects") {
          served = served.filter((r) => r === null || typeof r !== "object" || r.project_ref === scopeId);
        } else if (dataset === "schedule_calendars") {
          served = served.filter((r) => r === null || typeof r !== "object"
            || r.project_ref === scopeId
            || ((r.project_ref === undefined || r.project_ref === null) && authorizedGlobals.has(r.calendar_ref)));
        } else if (dataset === "schedule_lanes" || dataset === "schedule_blocks" || dataset === "schedule_blackout_windows") {
          served = served.filter((r) => r === null || typeof r !== "object" || r.project_ref === scopeId);
        } else if (dataset === "schedule_calendar_holidays") {
          const servedCalendars = new Set(
            (datasets.schedule_calendars ?? [])
              .filter((c) => c !== null && typeof c === "object" && (c.project_ref === scopeId
                || ((c.project_ref === undefined || c.project_ref === null) && authorizedGlobals.has(c.calendar_ref))))
              .map((c) => c.calendar_ref),
          );
          served = served.filter((r) => r === null || typeof r !== "object" || servedCalendars.has(r.calendar_ref));
        } else if (dataset === "schedule_dependencies") {
          const blockIds = new Set(
            (datasets.schedule_blocks ?? [])
              .filter((b) => b !== null && typeof b === "object" && b.project_ref === scopeId)
              .map((b) => b.block_ref),
          );
          served = served.filter((r) => r === null || typeof r !== "object"
            || blockIds.has(r.predecessor_ref) || blockIds.has(r.successor_ref));
        }
      }
      if (faults.getterCanaryDataset === dataset && served.length > 0) {
        const first = { ...served[0] };
        Object.defineProperty(first, "status", {
          enumerable: true,
          get() { throw new Error("getter canary invoked"); },
        });
        served = [first, ...served.slice(1)];
      }
      if (faults.proxyRowDataset === dataset && served.length > 0) {
        served = [new Proxy(served[0], {}), ...served.slice(1)];
      }
      if (faults.cyclicRowDataset === dataset && served.length > 0) {
        const first = { ...served[0] };
        first.self = first;
        served = [first, ...served.slice(1)];
      }
      if (faults.cursorLoopDataset === dataset) {
        const rows = cursor === null ? served.slice(0, pageSize) : [];
        return { rows, next_cursor: "loop", revision: "rev-1", expected_total: faults.hideExpected ? undefined : served.length };
      }
      const start = cursor === null ? 0 : Number(cursor);
      const rows = served.slice(start, start + pageSize);
      const next = start + pageSize < served.length ? String(start + pageSize) : null;
      const revision = faults.mixedRevisions ? `rev-${dataset}-${start}` : "rev-1";
      const expected = faults.hideExpected ? undefined : served.length;
      return { rows, next_cursor: next, revision, expected_total: expected };
    },
    close() { closed = true; },
  };
}
