// Team Brain slice 1 — test helpers. In-memory PGlite (or a temp data dir for
// restart tests). No network, no model calls, no wall-clock reads: every
// timestamp in these tests is a fixed literal.

import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { createRepository } from "../ledger/repository.mjs";
import { createHandoffMachine } from "../handoffs/stateMachine.mjs";

export const T0 = "2026-10-14T16:00:00Z";

// Test scratch lives on persistent disk, NOT the 512M /tmp tmpfs: each
// PGlite data directory is ~39MB and /tmp fills after a handful of runs.
const TEST_TMP = join(homedir(), "workspace", ".test-tmp");
mkdirSync(TEST_TMP, { recursive: true });
void tmpdir; // os.tmpdir intentionally unused (see above)

const CREATED_DIRS = [];

export function tempDir(prefix = "tb-test-") {
  const dir = mkdtempSync(join(TEST_TMP, prefix));
  CREATED_DIRS.push(dir);
  return dir;
}

export function cleanupTempDirs() {
  for (const dir of CREATED_DIRS.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function freshBackend(dataDir) {
  const db = dataDir ? new PGlite(dataDir) : new PGlite();
  const repo = createRepository(db);
  await repo.migrate();
  const handoffs = createHandoffMachine(db);
  return { db, repo, handoffs };
}

export function src(path, extra = {}) {
  return { repo: "onyxgolden/marketplace409", path, ...extra };
}

export function taskRecord(id, filedAt = T0, extra = {}) {
  return {
    id,
    kind: "TASK",
    filedAt,
    source: src("scripts/team-brain/README.md"),
    retentionDisposition: "close only on verified completion; never expire silently",
    filedBy: "test",
    filedReason: "test",
    ...extra,
  };
}

export function artifact(overrides = {}) {
  return {
    repo: "onyxgolden/marketplace409",
    path: "scripts/team-brain/report.json",
    commit: "abc123",
    blob: "blob123",
    head: "abc123",
    ...overrides,
  };
}

export function queueRef(overrides = {}) {
  return {
    repo: "onyxgolden/forge-ai-drop",
    path: "MASTER-TRACKER.md",
    commit: "def456",
    blob: "blob456",
    ...overrides,
  };
}
