// Team Brain P7 — disabled-worker cycle.
//
// One cycle = one scheduled invocation. The scheduler trigger IS the
// loop: each trigger runs one cycle for the current Chicago civil
// date, and the engine refuses off-slot, already-held, and
// wrong-identity invocations. There is deliberately no in-process
// daemon loop here: a loop that runs itself is activation, and
// activation is gated. Qualification runs invoke one cycle manually
// (--once) against an isolated database.
//
// Outcomes (all written as heartbeat rows except not-due, which is
// not a cycle at all):
//   COMPLETED — engine receipt stored (replayed receipts count: the
//     engine is idempotent, so a second cycle for the same date
//     replays instead of re-applying).
//   REFUSED_OVERLAP — the cooperative lease is held (another cycle
//     is running). No overlapping instances: the refused cycle
//     writes nothing except its heartbeat row.
//   FAILED — the cycle threw. Detail carries the error name + code
//     only, never payloads.
//   STOPPED — a stop file was present; the cycle refused to start
//     (the kill switch). The hard kill on Windows is schtasks /End
//     plus /Disable (see stop-worker-task.ps1); the stop file is
//     the portable, provable half.
//   notDue — the slot has not arrived. No heartbeat row: the
//     observer must see the last REAL cycle, not a no-op stamp.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createConsolidationEngine, P6_CODES } from "../consolidation/engine.mjs";
import { civilDateInChicago } from "../consolidation/scheduling.mjs";
import { stableStringify } from "../report/stableStringify.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

export function loadWorkerSchemaSql() {
  return readFileSync(join(HERE, "schema.sql"), "utf8");
}

export async function migrateWorker(db) {
  if (!db || typeof db.exec !== "function") {
    throw new Error("migrateWorker requires a handle with exec(sql) (PGlite-style single connection)");
  }
  await db.exec(loadWorkerSchemaSql());
}

function sha32(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

async function writeHeartbeat(db, { workerId, recordedAt, runDate, state, receiptHash, detail }) {
  await db.query(
    `INSERT INTO tb_worker_heartbeats (worker_id, recorded_at, run_date, state, receipt_hash, detail)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [workerId, recordedAt, runDate ?? null, state, receiptHash ?? null, detail ?? null],
  );
}

export function createWorker(db, config, { engineFactory = createConsolidationEngine } = {}) {
  if (!db || typeof db.query !== "function") {
    throw new Error("createWorker requires a query handle (db.query)");
  }
  const engine = engineFactory(db);

  async function runCycle({ nowIso } = {}) {
    const now = nowIso ?? new Date().toISOString();
    const civilDate = civilDateInChicago(now);

    if (config.stopFile != null && existsSync(config.stopFile)) {
      await writeHeartbeat(db, {
        workerId: config.workerId,
        recordedAt: now,
        runDate: civilDate,
        state: "STOPPED",
        detail: "stop file present",
      });
      return { stopped: true, civilDate, reason: "stop file present" };
    }

    let receipt;
    try {
      receipt = await engine.runConsolidation({
        runDate: civilDate,
        principal: config.principal,
        now,
      });
    } catch (err) {
      if (err != null && err.code === P6_CODES.SLOT_NOT_DUE) {
        return { notDue: true, civilDate, now };
      }
      if (err != null && err.code === P6_CODES.LEASE_HELD) {
        await writeHeartbeat(db, {
          workerId: config.workerId,
          recordedAt: now,
          runDate: civilDate,
          state: "REFUSED_OVERLAP",
          detail: "LEASE_HELD",
        });
        return { refusedOverlap: true, civilDate, reason: "LEASE_HELD" };
      }
      // Best effort: if the database itself is down, the FAILED
      // heartbeat cannot be written either — swallow that write
      // error so the original failure is what propagates.
      try {
        await writeHeartbeat(db, {
          workerId: config.workerId,
          recordedAt: now,
          runDate: civilDate,
          state: "FAILED",
          detail: `${err?.name ?? "Error"}:${err?.code ?? "UNKNOWN"}`,
        });
      } catch {
        // original error below is the reportable one
      }
      throw err;
    }

    const receiptHash = sha32(stableStringify(receipt));
    await writeHeartbeat(db, {
      workerId: config.workerId,
      recordedAt: now,
      runDate: civilDate,
      state: "COMPLETED",
      receiptHash,
    });
    return { completed: true, civilDate, replayed: receipt.replayed === true, receiptHash };
  }

  return { runCycle };
}
