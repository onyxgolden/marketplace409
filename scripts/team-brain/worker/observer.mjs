// Team Brain P7 — independent status observer adapter.
//
// The observer watches the worker through a SEPARATE read-only
// connection (tb_reader role, separate credentials from the worker).
// It never writes: this module issues SELECT statements only, and
// the tb_reader grants contain no write privilege anywhere, so a
// write attempt fails at the database, not just by convention.
//
// Freshness means "a cycle COMPLETED recently," not "a row exists":
// a STOPPED, FAILED, or REFUSED_OVERLAP heartbeat is evidence the
// worker is not completing cycles, so it never counts as fresh.
// An unparseable timestamp is never fresh either — fail closed.

export function createObserver(readerDb) {
  if (!readerDb || typeof readerDb.query !== "function") {
    throw new Error("createObserver requires a query handle (readerDb.query)");
  }

  async function latestHeartbeat(workerId) {
    const { rows } = await readerDb.query(
      `SELECT id, worker_id, recorded_at, run_date, state, receipt_hash, detail
       FROM tb_worker_heartbeats WHERE worker_id = $1 ORDER BY id DESC LIMIT 1`,
      [workerId],
    );
    return rows.length ? rows[0] : null;
  }

  async function runStatus(runDate) {
    const { rows } = await readerDb.query(
      `SELECT run_date, state, source_revision, episodes_considered, episodes_promoted
       FROM tb_consolidation_runs WHERE run_date = $1`,
      [runDate],
    );
    return rows.length ? rows[0] : null;
  }

  // Default freshness window is 26h (one missed 03:00 slot + margin);
  // without a default, an omitted maxAgeMs would compare against
  // undefined and never report stale.
  async function freshness(workerId, { nowIso, maxAgeMs = 26 * 60 * 60 * 1000 }) {
    const last = await latestHeartbeat(workerId);
    if (last == null) {
      return { fresh: false, ageMs: null, last: null, reason: "no heartbeat" };
    }
    const recordedMs = Date.parse(last.recorded_at);
    if (Number.isNaN(recordedMs)) {
      return { fresh: false, ageMs: null, last, reason: "unparseable heartbeat timestamp" };
    }
    const ageMs = Date.parse(nowIso) - recordedMs;
    if (last.state !== "COMPLETED") {
      return { fresh: false, ageMs, last, reason: `last heartbeat state is ${last.state}, not COMPLETED` };
    }
    if (ageMs < 0 || ageMs > maxAgeMs) {
      return { fresh: false, ageMs, last, reason: `heartbeat age ${ageMs}ms exceeds ${maxAgeMs}ms` };
    }
    return { fresh: true, ageMs, last, reason: null };
  }

  return { latestHeartbeat, runStatus, freshness };
}
