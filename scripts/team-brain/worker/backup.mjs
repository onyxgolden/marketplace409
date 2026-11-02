// Team Brain P7 — backup / export / isolated-restore tools.
//
// Export writes one JSON document: per-table rows plus a manifest of
// counts and digests. Restore loads it into an ISOLATED database
// (never production) and verifyParity proves count / history /
// digest / queue parity between source and target.
//
// Surrogate sequence columns (BIGSERIAL/identity) are excluded from
// exported rows and digests: they are regenerated on restore, and
// content parity — not surrogate values — is what history parity
// means. The exclusion list is part of the manifest, so a parity
// check can never silently compare different column sets.
//
// Pruning deletes backup FILES only, never database rows: rotation
// drops old backup artifacts, not logical records.

import { createHash } from "node:crypto";
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { stableStringify } from "../report/stableStringify.mjs";

export const BACKUP_VERSION = "p7-backup-1";

// Foreign-key-safe table order (parents before children). The only
// self-referential table is team_brain_obligations (supersedes /
// superseded_by); restore inserts it iteratively until no progress.
export const BACKUP_TABLES = Object.freeze([
  "team_brain_schema_version",
  "team_brain_obligations",
  "team_brain_obligation_dependencies",
  "team_brain_obligation_events",
  "team_brain_handoffs",
  "team_brain_handoff_events",
  "tb_retrieval_revisions",
  "tb_episodes",
  "tb_episode_grants",
  "tb_pins",
  "tb_working_set",
  "tb_episode_events",
  "tb_consolidation_runs",
  "tb_consolidation_lease",
  "tb_consolidated_facts",
  "tb_consolidation_proposals",
  "tb_consolidation_checkpoints",
  "tb_consolidation_run_bindings",
  "tb_consolidation_audit",
  "tb_worker_heartbeats",
]);

export const SURROGATE_COLUMNS = Object.freeze({
  team_brain_obligation_events: ["seq"],
  team_brain_handoff_events: ["seq"],
  tb_episode_events: ["event_id"],
  tb_consolidation_audit: ["seq"],
  tb_worker_heartbeats: ["id"],
});

function stripSurrogates(table, row) {
  const drop = SURROGATE_COLUMNS[table] ?? [];
  if (!drop.length) return row;
  const out = { ...row };
  for (const c of drop) delete out[c];
  return out;
}

function digestRows(rows) {
  const h = createHash("sha256");
  for (const r of rows) h.update(stableStringify(r)).update("\n");
  return h.digest("hex");
}

function sortedRows(rows) {
  return [...rows].sort((a, b) => (stableStringify(a) < stableStringify(b) ? -1 : 1));
}

// Read a table's content for backup/parity: only stored columns.
// Generated columns (e.g. tb_episodes.search_vector) are computed by
// the database and cannot be inserted explicitly, so they are excluded
// from both export and parity — they regenerate identically on restore.
async function readTableContent(db, table) {
  const { rows: cols } = await db.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND is_generated = 'NEVER'
     ORDER BY ordinal_position`,
    [table],
  );
  const names = cols.map((c) => c.column_name);
  const { rows } = await db.query(`SELECT ${names.map((c) => `"${c}"`).join(", ")} FROM ${table}`);
  return sortedRows(rows.map((r) => stripSurrogates(table, r)));
}

export async function exportBackup(db) {
  const tables = {};
  for (const table of BACKUP_TABLES) {
    const content = await readTableContent(db, table);
    tables[table] = { count: content.length, sha256: digestRows(content), rows: content };
  }
  return {
    version: BACKUP_VERSION,
    tables,
    surrogateColumns: SURROGATE_COLUMNS,
  };
}

// Singleton rows exist in a fresh target already (migration seeds
// them), so a plain DO NOTHING restore would leave stale values
// (e.g. intake revision 0 instead of the backed-up revision). These
// three upsert instead; every other table restores into an empty
// target, so DO NOTHING is exact there.
const SINGLETON_UPSERT = {
  team_brain_schema_version:
    "ON CONFLICT (version) DO UPDATE SET applied_at = EXCLUDED.applied_at",
  tb_retrieval_revisions:
    "ON CONFLICT (id) DO UPDATE SET revision = EXCLUDED.revision",
  tb_consolidation_lease:
    "ON CONFLICT (id) DO UPDATE SET generation = EXCLUDED.generation, holder = EXCLUDED.holder, run_date = EXCLUDED.run_date, acquired_at = EXCLUDED.acquired_at",
};

async function insertRows(db, table, rows) {
  if (!rows.length) return 0;
  const cols = Object.keys(rows[0]);
  const placeholders = (i) => cols.map((_, j) => `$${i * cols.length + j + 1}`).join(", ");
  const values = rows.flatMap((r) => cols.map((c) => r[c]));
  const sql =
    `INSERT INTO ${table} (${cols.join(", ")}) VALUES ` +
    rows.map((_, i) => `(${placeholders(i)})`).join(", ") +
    " " + (SINGLETON_UPSERT[table] ?? "ON CONFLICT DO NOTHING");
  await db.query(sql, values);
  return rows.length;
}

/**
 * Load a backup into an isolated database. Returns per-table inserted
 * counts. Throws if a self-referential obligations batch cannot make
 * progress (a supersedes cycle) instead of silently dropping rows.
 */
export async function importRestore(db, backup) {
  if (backup == null || backup.version !== BACKUP_VERSION) {
    throw new Error(`importRestore requires a ${BACKUP_VERSION} backup document`);
  }
  const inserted = {};
  for (const table of BACKUP_TABLES) {
    const rows = backup.tables?.[table]?.rows ?? [];
    if (table === "team_brain_obligations") {
      let remaining = [...rows];
      let done = 0;
      while (remaining.length) {
        const before = remaining.length;
        const kept = [];
        for (const row of remaining) {
          try {
            await insertRows(db, table, [row]);
            done += 1;
          } catch {
            kept.push(row);
          }
        }
        remaining = kept;
        if (remaining.length === before) {
          throw new Error(
            `importRestore stalled on team_brain_obligations: ${remaining.length} rows cannot satisfy self-references (possible supersedes cycle)`,
          );
        }
      }
      inserted[table] = done;
    } else {
      inserted[table] = await insertRows(db, table, rows);
    }
  }
  return inserted;
}

/** Compare a live database against a backup manifest. Content parity only. */
export async function verifyParity(db, backup) {
  const tables = {};
  let ok = true;
  for (const table of BACKUP_TABLES) {
    const content = await readTableContent(db, table);
    const sha256 = digestRows(content);
    const expected = backup.tables?.[table];
    const match = expected != null && expected.count === content.length && expected.sha256 === sha256;
    if (!match) ok = false;
    tables[table] = {
      ok: match,
      count: content.length,
      expectedCount: expected?.count ?? null,
      sha256,
      expectedSha256: expected?.sha256 ?? null,
    };
  }
  return { ok, tables };
}

/**
 * Rotate backup files: keep the newest file per day for the newest
 * `dailyVersions` days, delete the rest. Files only — never touches
 * any database. Backup files are named tb-backup-YYYY-MM-DD-*.json.
 */
export function pruneBackups(dir, { dailyVersions = 30 } = {}) {
  const files = readdirSync(dir).filter((f) => /^tb-backup-\d{4}-\d{2}-\d{2}-.*\.json$/.test(f));
  const byDay = new Map();
  for (const f of files.sort()) {
    const day = f.slice("tb-backup-".length, "tb-backup-".length + 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(f);
  }
  const days = [...byDay.keys()].sort();
  const keepDays = new Set(days.slice(-dailyVersions));
  const kept = [];
  const deleted = [];
  for (const [day, dayFiles] of byDay) {
    const sorted = [...dayFiles].sort();
    const keep = keepDays.has(day) ? [sorted[sorted.length - 1]] : [];
    for (const f of sorted) {
      if (keep.includes(f)) kept.push(f);
      else {
        rmSync(join(dir, f));
        deleted.push(f);
      }
    }
  }
  return { kept, deleted };
}
