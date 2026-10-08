// Evidence adapter types (Slice 2) — read-only, fail-closed.
//
// Each adapter is an async function `(spec, deps, now) => result` where
// result is ALWAYS `{ ok: true, evidence }` or `{ ok: false, error }`.
// Adapters never throw, never return partial data as success, and never
// write: the Supabase adapter issues only `.select()`, the GitHub adapter
// only GET requests. I/O is injected through `deps` so tests run against
// fakes with no network.
//
// `now` is an injected epoch-ms timestamp (not read from the clock) so
// window arithmetic is deterministic in tests.

/**
 * Supabase table evidence: the latest row's time and the EXACT row count
 * inside the query window, for one table + time column.
 *
 * spec: { table, timeColumn, windowHours, idColumn?, filters? }
 *   filters: [{ column, op: "eq"|"like", value }] — ANDed conditions.
 * deps: { supabase: ... }
 * now: epoch ms (used only when no explicit window is given).
 * opts.slotWindow: { startIso, endIso } — when present, BOTH queries are
 *   scoped to exactly this window (Slice 4 review: query the slot, not
 *   the latest record). Otherwise the trailing windowHours window is used.
 *
 * Two queries: a head-only exact count and the latest row, both in the
 * same window. They must agree; disagreement fails closed.
 */
export async function fetchSupabaseTableEvidence(spec, deps, now, opts = {}) {
  const fail = (error) => ({ ok: false, error });
  try {
    if (!deps || !deps.supabase || typeof deps.supabase.from !== "function") {
      return fail("supabase client not provided");
    }
    const { table, timeColumn, windowHours } = spec;
    if (!table || !timeColumn) {
      return fail("spec needs table and timeColumn");
    }
    let startIso, endIso;
    if (opts.slotWindow && opts.slotWindow.startIso && opts.slotWindow.endIso) {
      startIso = opts.slotWindow.startIso;
      endIso = opts.slotWindow.endIso;
    } else {
      if (!Number.isFinite(windowHours) || windowHours <= 0) {
        return fail("spec needs windowHours or an explicit slotWindow");
      }
      startIso = new Date(now - windowHours * 3600 * 1000).toISOString();
      endIso = new Date(now).toISOString();
    }
    const idColumn = spec.idColumn || "id";
    const client = deps.supabase.from(table);

    const badShape = (which, detail) =>
      fail(`supabase ${which} query on ${table} returned a malformed response (${detail})`);

    const filters = spec.filters || [];
    for (const f of filters) {
      if (!f || typeof f.column !== "string" || (f.op !== "eq" && f.op !== "like")) {
        return fail(`supabase adapter on ${table}: malformed filter ${JSON.stringify(f)}`);
      }
    }
    const applyFilters = (q) => {
      let chain = q.gte(timeColumn, startIso).lt(timeColumn, endIso);
      for (const f of filters) {
        chain = f.op === "eq" ? chain.eq(f.column, f.value) : chain.like(f.column, f.value);
      }
      return chain;
    };

    // Query 1: exact count in window, head-only.
    const countRes = await applyFilters(client.select(idColumn, { count: "exact", head: true }));
    if (!countRes || typeof countRes !== "object" || Array.isArray(countRes)) {
      return badShape("count", "not an object");
    }
    if (countRes.error) {
      return fail(`supabase count query failed on ${table}: ${countRes.error.message || countRes.error}`);
    }
    if (!Number.isInteger(countRes.count)) {
      return badShape("count", "count is not an integer");
    }

    // Query 2: latest row in the window.
    const latestRes = await applyFilters(
      client
        .select(`${idColumn},${timeColumn}`)
        .order(timeColumn, { ascending: false })
        .limit(1)
    );
    if (!latestRes || typeof latestRes !== "object" || Array.isArray(latestRes)) {
      return badShape("latest-row", "not an object");
    }
    if (latestRes.error) {
      return fail(`supabase latest-row query failed on ${table}: ${latestRes.error.message || latestRes.error}`);
    }
    if (!Array.isArray(latestRes.data)) {
      // The Slice 2 review finding: non-array data must fail, never
      // silently become "zero rows".
      return badShape("latest-row", "data is not an array");
    }
    let latestAt = null;
    if (latestRes.data.length > 0) {
      const row = latestRes.data[0];
      if (!row || typeof row !== "object" || typeof row[timeColumn] !== "string") {
        return badShape("latest-row", `row is missing a usable "${timeColumn}"`);
      }
      latestAt = row[timeColumn];
    }

    // The two queries must agree; a race or a lying client fails closed.
    if ((countRes.count === 0) !== (latestAt === null)) {
      return fail(
        `supabase evidence on ${table} is inconsistent: count=${countRes.count} but latestAt=${latestAt}`
      );
    }

    return {
      ok: true,
      evidence: {
        source: `supabase:${table}`,
        table,
        timeColumn,
        windowHours: opts.slotWindow ? null : windowHours,
        slotWindow: opts.slotWindow ? { startIso, endIso } : null,
        filters: filters.map((f) => ({ column: f.column, op: f.op, value: f.value })),
        rowCount: countRes.count,
        latestAt,
        // latestAt null with rowCount 0 means "no evidence in window" —
        // a finding for Slice 3, not an adapter failure.
      },
    };
  } catch (e) {
    return fail(`supabase adapter threw: ${e && e.message ? e.message : String(e)}`);
  }
}

/**
 * GitHub Actions evidence: recent runs of one workflow file.
 *
 * spec: { workflowFile }  (e.g. "rental-cron-sweeps.yml")
 * deps: { githubApi: { listWorkflowRuns(workflowFile): Promise<runs[]> } }
 *   runs[]: [{ conclusion, status, startedAt, htmlUrl }]
 * opts.slotWindow: { startIso, endIso } — when present, only runs started
 *   inside the window are considered (Slice 4 review: query the slot).
 *   `totalFetched` always reports how many runs the API returned, so the
 *   evaluator can distinguish "API working, slot empty" from "no history".
 */
export async function fetchGithubActionsEvidence(spec, deps, now, opts = {}) {
  const fail = (error) => ({ ok: false, error });
  try {
    if (!deps || !deps.githubApi || typeof deps.githubApi.listWorkflowRuns !== "function") {
      return fail("github api client not provided");
    }
    if (!spec.workflowFile) {
      return fail("spec needs workflowFile");
    }
    const allRuns = await deps.githubApi.listWorkflowRuns(spec.workflowFile);
    if (!Array.isArray(allRuns)) {
      return fail("github api returned a non-array run list");
    }
    const slotWindow = opts.slotWindow && opts.slotWindow.startIso && opts.slotWindow.endIso
      ? opts.slotWindow
      : null;
    const runs = slotWindow
      ? allRuns.filter((r) => typeof r.startedAt === "string" && r.startedAt >= slotWindow.startIso && r.startedAt < slotWindow.endIso)
      : allRuns;
    if (runs.length === 0) {
      return {
        ok: true,
        evidence: {
          source: `github-actions:${spec.workflowFile}`,
          runCount: 0,
          totalFetched: allRuns.length,
          slotWindow: slotWindow ? { ...slotWindow } : null,
          latest: null,
        },
      };
    }
    const latest = runs[0];
    for (const f of ["conclusion", "status", "startedAt"]) {
      if (latest[f] === undefined) {
        return fail(`latest run is missing field "${f}"`);
      }
    }
    return {
      ok: true,
      evidence: {
        source: `github-actions:${spec.workflowFile}`,
        runCount: runs.length,
        totalFetched: allRuns.length,
        slotWindow: slotWindow ? { ...slotWindow } : null,
        latest: {
          conclusion: latest.conclusion,
          status: latest.status,
          startedAt: latest.startedAt,
          url: latest.htmlUrl || null,
        },
      },
    };
  } catch (e) {
    return fail(`github adapter threw: ${e && e.message ? e.message : String(e)}`);
  }
}

/** Dispatch table: adapter type -> implementation. Unknown types fail closed. */
export const ADAPTER_TYPES = Object.freeze({
  "supabase-table": fetchSupabaseTableEvidence,
  "github-actions": fetchGithubActionsEvidence,
});
