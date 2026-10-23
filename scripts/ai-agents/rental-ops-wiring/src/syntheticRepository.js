/**
 * Synthetic repository adapter — the ONLY adapter installed in this
 * release. It serves invented rows from memory, owner-scoped the way
 * the future authorized read capability will be (rows are filtered to
 * the requested owner, like RLS would), paged, with declarative fault
 * injection for the coverage battery. It contains no credentials, no
 * network, no SQL and no filesystem access.
 *
 * Fault knobs (test-only, set by the harness — never by a job
 * request): failDataset, leakyOwners (return every owner's rows),
 * blockedDataset (a page read that never settles), pageSize,
 * mixedRevisions, revoked, staleSession, getterCanaryDataset.
 */
export function createSyntheticAdapter({ datasets, faults = {} }) {
  const calls = [];
  let closed = false;
  return {
    source_system: "synthetic-repository",
    calls,
    get closed() { return closed; },
    async collect(dataset, { owner_ref, cursor }) {
      calls.push({ dataset, owner_ref, cursor });
      if (faults.revoked) throw Object.assign(new Error("permission revoked"), { code: "PERMISSION_REVOKED" });
      if (faults.staleSession) throw Object.assign(new Error("stale session"), { code: "STALE_SESSION" });
      if (faults.failDataset === dataset) throw Object.assign(new Error("source down"), { code: "SOURCE_DOWN" });
      if (faults.blockedDataset === dataset) return new Promise(() => {});
      const pageSize = faults.pageSize ?? 100;
      let all = (datasets[dataset] ?? []).filter((r) => faults.leakyOwners || r === null || typeof r !== "object" || r.owner_ref === owner_ref);
      if (faults.getterCanaryDataset === dataset && all.length > 0) {
        const first = { ...all[0] };
        Object.defineProperty(first, "status", {
          enumerable: true,
          get() { throw new Error("getter canary invoked"); },
        });
        all = [first, ...all.slice(1)];
      }
      if (faults.proxyRowDataset === dataset && all.length > 0) {
        all = [new Proxy(all[0], {}), ...all.slice(1)];
      }
      if (faults.cyclicRowDataset === dataset && all.length > 0) {
        const first = { ...all[0] };
        first.self = first;
        all = [first, ...all.slice(1)];
      }
      if (faults.cursorLoopDataset === dataset) {
        // A broken source that hands back the same cursor forever; the
        // builder must fault it (CURSOR_FAULT), never loop or truncate.
        const rows = cursor === null ? all.slice(0, pageSize) : [];
        return { rows, next_cursor: "loop", revision: "rev-1", expected_total: faults.hideExpected ? undefined : all.length };
      }
      const start = cursor === null ? 0 : Number(cursor);
      const rows = all.slice(start, start + pageSize);
      const next = start + pageSize < all.length ? String(start + pageSize) : null;
      const revision = faults.mixedRevisions ? `rev-${dataset}-${start}` : "rev-1";
      const expected = faults.hideExpected ? undefined : all.length;
      return { rows, next_cursor: next, revision, expected_total: expected };
    },
    close() { closed = true; },
  };
}
