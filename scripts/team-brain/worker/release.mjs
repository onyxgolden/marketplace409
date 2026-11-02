// Team Brain P7 — release manifest builder.
//
// The manifest is GENERATED from the actual tree, never hand-pinned:
// dependency versions come from package-lock.json, file hashes are
// recomputed over the shipped files, and the migration list names
// the exact schema files. A manifest that drifts from the tree fails
// its own test (tbp7Worker.test.mjs recomputes every hash).
// Deterministic by construction: no timestamps, no absolute paths,
// no runtime versions inside the manifest itself.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_SCHEMA_VERSION } from "./config.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEAM_BRAIN = dirname(HERE);

export const PACKAGE_VERSION = "7.0.0";

const SHIPPED_FILES = Object.freeze([
  "worker/config.mjs",
  "worker/worker.mjs",
  "worker/observer.mjs",
  "worker/health.mjs",
  "worker/backup.mjs",
  "worker/reconcile.mjs",
  "worker/release.mjs",
  "worker/schema.sql",
  "worker/runbook.md",
  "worker/task-definition.xml",
  "worker/register-worker-task.ps1",
  "worker/stop-worker-task.ps1",
  "worker/run.mjs",
  "worker/config.template.json",
  "worker/vault-recipe.md",
  "postgres/roles.sql",
  "postgres/connection.mjs",
]);

const MIGRATIONS = Object.freeze([
  "migrations/001_team_brain_schema.sql",
  "retrieval/schema.sql",
  "consolidation/schema.sql",
  "worker/schema.sql",
  "postgres/roles.sql",
]);

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function lockVersion(lock, pkgPath) {
  const entry = lock.packages?.[pkgPath];
  if (entry?.version == null) throw new Error(`package-lock has no version for ${pkgPath}`);
  return entry.version;
}

/**
 * Build the release manifest. repoRoot defaults to the marketplace409
 * checkout root (three levels above this file: worker -> team-brain
 * -> scripts -> root). sourceTree, when supplied, is echoed verbatim
 * (callers pass `git rev-parse HEAD^{tree}`); it is never computed
 * here, so the manifest stays pure and deterministic.
 */
export function buildReleaseManifest({ repoRoot = null, sourceTree = null } = {}) {
  const root = repoRoot ?? join(HERE, "..", "..", "..");
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  // Paths are repo-relative so anyone can verify the bundle from the
  // checkout root without knowing this file's location.
  const files = SHIPPED_FILES.map((rel) => ({
    path: `scripts/team-brain/${rel}`,
    sha256: sha256File(join(TEAM_BRAIN, rel)),
  }));
  const migrations = MIGRATIONS.map((rel) => ({
    file: `scripts/team-brain/${rel}`,
    sha256: sha256File(join(TEAM_BRAIN, rel)),
  }));
  return {
    package: "team-brain-worker",
    version: PACKAGE_VERSION,
    nodeRequired: 24,
    configSchemaVersion: CONFIG_SCHEMA_VERSION,
    dependencies: {
      pg: lockVersion(lock, "node_modules/pg"),
      pglite: lockVersion(lock, "node_modules/@electric-sql/pglite"),
    },
    files,
    migrations,
    sourceTree,
  };
}
