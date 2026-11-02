#!/usr/bin/env node
// Team Brain P7 — worker CLI (operator entry point).
//
// One command per invocation; outputs JSON on stdout, errors on
// stderr with a nonzero exit. This CLI never prints a credential,
// an episode body, or a callback payload.
//
//   --validate-config   Validate config only (no database needed).
//   --once              Run one consolidation cycle for the current
//                       Chicago civil date (qualification use; the
//                       scheduler trigger is the loop, not this CLI).
//   --check             Full health probes. Add --owner-user +
//                       --owner-password-env for full grant
//                       verification; without them, grant/pending
//                       probes report NOT_VISIBLE (overall PARTIAL).
//   --observer          Observer freshness report (read-only).
//   --backup <file>     Export a backup document (read-only).
//   --restore <file>    Restore into an ISOLATED database (owner
//                       credentials via --restore-user +
//                       --restore-password-env; refuses worker/reader
//                       users and refuses the worker's own database).
//   --reconcile         Reconcile report (read-only, never rewrites).
//
// Restore target databases must already have the P1, P5, P6, and
// worker schemas applied (schema files in migrations/, retrieval/,
// consolidation/, worker/); --restore loads data and verifies
// parity, it does not migrate. The pg Pool path is proven at host
// qualification (qualified Windows host, real server); library
// behavior is proven in PGlite tests.

import { readFileSync, writeFileSync } from "node:fs";
// pg is CommonJS: Node 24 ESM cannot take named exports from it.
import pg from "pg";
const { Pool } = pg;
import { validateWorkerConfig } from "./config.mjs";
import {
  CONSOLIDATOR_ROLE,
  READER_ROLE,
  createTrustedPool,
  withTrustedClient,
} from "../postgres/connection.mjs";
import { createWorker } from "./worker.mjs";
import { createObserver } from "./observer.mjs";
import { runHealthProbes } from "./health.mjs";
import { exportBackup, importRestore, verifyParity } from "./backup.mjs";
import { reconcileReport } from "./reconcile.mjs";

const HELP = `team-brain worker CLI
Usage: node run.mjs --config <path> <command> [options]
Commands:
  --validate-config
  --once
  --check [--owner-user <user> --owner-password-env <NAME>]
  --observer
  --backup <file>
  --restore <file> --restore-user <user> --restore-password-env <NAME>
  --reconcile
  --help`;

function parseArgs(argv) {
  const args = { command: null, backupFile: null, restoreFile: null, ownerUser: null, ownerPasswordEnv: null, restoreUser: null, restorePasswordEnv: null };
  let configPath = null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--config") configPath = argv[++i];
    else if (a === "--validate-config") args.command = "validate-config";
    else if (a === "--once") args.command = "once";
    else if (a === "--check") args.command = "check";
    else if (a === "--observer") args.command = "observer";
    else if (a === "--backup") { args.command = "backup"; args.backupFile = argv[++i]; }
    else if (a === "--restore") { args.command = "restore"; args.restoreFile = argv[++i]; }
    else if (a === "--reconcile") args.command = "reconcile";
    else if (a === "--owner-user") args.ownerUser = argv[++i];
    else if (a === "--owner-password-env") args.ownerPasswordEnv = argv[++i];
    else if (a === "--restore-user") args.restoreUser = argv[++i];
    else if (a === "--restore-password-env") args.restorePasswordEnv = argv[++i];
    else if (a === "--help") args.command = "help";
    else throw new Error(`unknown argument: ${a}`);
  }
  return { configPath, args };
}

function loadConfig(configPath) {
  if (configPath == null) throw new Error("--config <path> is required");
  const raw = JSON.parse(readFileSync(configPath, "utf8"));
  return validateWorkerConfig(raw);
}

function poolFor(endpoint, expectedRole) {
  return createTrustedPool(endpoint, { expectedRole, createPool: (opts) => new Pool(opts) });
}

async function endAll(pools) {
  for (const p of pools) {
    try {
      await p.end();
    } catch {
      // best effort on shutdown
    }
  }
}

async function main(argv) {
  const { configPath, args } = parseArgs(argv);
  if (args.command === "help") {
    console.log(HELP);
    return;
  }
  if (args.command == null) throw new Error("a command is required (see --help)");
  const config = loadConfig(configPath);

  if (args.command === "validate-config") {
    console.log(JSON.stringify({ valid: true, workerId: config.workerId, configSchemaVersion: config.configSchemaVersion }));
    return;
  }

  const pools = [];
  try {
    const workerPool = poolFor(config.database, CONSOLIDATOR_ROLE);
    const observerPool = poolFor(config.observer, READER_ROLE);
    pools.push(workerPool, observerPool);

    if (args.command === "once") {
      const receipt = await withTrustedClient(workerPool, CONSOLIDATOR_ROLE, async (client) =>
        createWorker(client, config).runCycle({ nowIso: new Date().toISOString() }),
      );
      console.log(JSON.stringify(receipt));
      return;
    }

    if (args.command === "observer") {
      const observer = createObserver(observerPool);
      const report = await observer.freshness(config.workerId, {
        nowIso: new Date().toISOString(),
        maxAgeMs: 26 * 60 * 60 * 1000,
      });
      console.log(JSON.stringify(report));
      return;
    }

    if (args.command === "check") {
      let dbPool = workerPool;
      if (args.ownerUser != null || args.ownerPasswordEnv != null) {
        if (args.ownerUser == null || args.ownerPasswordEnv == null) {
          throw new Error("--check owner mode requires both --owner-user and --owner-password-env");
        }
        const ownerPool = createTrustedPool(
          { ...config.database, user: args.ownerUser, passwordEnv: args.ownerPasswordEnv },
          { expectedRole: args.ownerUser, createPool: (opts) => new Pool(opts) },
        );
        pools.push(ownerPool);
        dbPool = ownerPool;
      }
      const observer = createObserver(observerPool);
      const health = await runHealthProbes({
        db: dbPool,
        readerDb: observerPool,
        observer,
        config,
        workerId: config.workerId,
        nowIso: new Date().toISOString(),
      });
      console.log(JSON.stringify(health));
      if (health.status === "FAIL" || health.status === "UNQUALIFIED") process.exitCode = 1;
      return;
    }

    if (args.command === "backup") {
      if (args.backupFile == null) throw new Error("--backup requires a file path");
      const backup = await exportBackup(observerPool);
      writeFileSync(args.backupFile, JSON.stringify(backup, null, 2));
      const counts = Object.fromEntries(Object.entries(backup.tables).map(([t, v]) => [t, v.count]));
      console.log(JSON.stringify({ file: args.backupFile, version: backup.version, tables: counts }));
      return;
    }

    if (args.command === "restore") {
      if (args.restoreFile == null) throw new Error("--restore requires a file path");
      if (args.restoreUser == null || args.restorePasswordEnv == null) {
        throw new Error("--restore requires --restore-user and --restore-password-env (owner credentials, never worker/reader)");
      }
      if (args.restoreUser === CONSOLIDATOR_ROLE || args.restoreUser === READER_ROLE) {
        throw new Error(`--restore refuses worker/reader user ${args.restoreUser}: restore needs owner credentials`);
      }
      const targetDatabase = process.env.TB_RESTORE_DATABASE;
      if (targetDatabase == null || targetDatabase === "") {
        throw new Error("TB_RESTORE_DATABASE must name the isolated target database (never the worker database)");
      }
      if (targetDatabase === config.database.database) {
        throw new Error("refusing to restore into the worker's own database");
      }
      const ownerPool = createTrustedPool(
        {
          host: config.database.host,
          port: config.database.port,
          database: targetDatabase,
          user: args.restoreUser,
          passwordEnv: args.restorePasswordEnv,
          ssl: config.database.ssl,
          allowInsecureLocal: config.database.allowInsecureLocal,
        },
        { expectedRole: args.restoreUser, createPool: (opts) => new Pool(opts) },
      );
      pools.push(ownerPool);
      const backup = JSON.parse(readFileSync(args.restoreFile, "utf8"));
      const inserted = await importRestore(ownerPool, backup);
      const parity = await verifyParity(ownerPool, backup);
      console.log(JSON.stringify({ file: args.restoreFile, targetDatabase, inserted, parityOk: parity.ok }));
      if (!parity.ok) {
        console.log(JSON.stringify({ parityMismatches: Object.entries(parity.tables).filter(([, v]) => !v.ok) }));
        process.exitCode = 1;
      }
      return;
    }

    if (args.command === "reconcile") {
      const report = await reconcileReport(observerPool);
      console.log(JSON.stringify(report));
      return;
    }

    throw new Error(`unhandled command: ${args.command}`);
  } finally {
    await endAll(pools);
  }
}

main(process.argv.slice(2)).catch((err) => {
  console.error(JSON.stringify({ error: err.name ?? "Error", code: err.code ?? "UNKNOWN", message: err.message ?? String(err) }));
  process.exit(1);
});
