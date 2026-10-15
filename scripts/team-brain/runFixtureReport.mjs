#!/usr/bin/env node
// Team Brain slice 1 — synthetic fixture CLI (local only).
//
//   node scripts/team-brain/runFixtureReport.mjs --fixture <path> --db <path> --now <ISO-UTC> [--out <path>]
//
// - --now is REQUIRED and must be a UTC ISO-8601 timestamp. The CLI never
//   reads the wall clock; omitting --now is a hard error, not a default.
// - Only synthetic fixtures (fixture.schemaVersion 1, synthetic === true).
// - No network, no model calls. Reads fixture JSON, writes JSON report.
// - Byte-identical output for identical input, database state, and now.
//
// Exit codes: 0 ok; 2 usage/validation error; 3 fixture/lifecycle error.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, basename } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { createRepository } from "./ledger/repository.mjs";
import { createHandoffMachine } from "./handoffs/stateMachine.mjs";
import { validateFixture } from "./report/fixtureSchema.mjs";
import { buildFixtureReport } from "./report/buildReport.mjs";
import { stableStringify } from "./report/stableStringify.mjs";
import { assertUtcIso } from "./ledger/validation.mjs";
import { TeamBrainError } from "./ledger/errors.mjs";

function usage() {
  return [
    "usage: node scripts/team-brain/runFixtureReport.mjs --fixture <path> --db <path> --now <ISO-UTC> [--out <path>]",
    "  --fixture  synthetic fixture JSON (schemaVersion 1, synthetic: true)",
    "  --db       PGlite data directory (created if missing; local only)",
    "  --now      injected UTC time, e.g. 2026-10-14T19:00:00Z (required; never defaults to wall clock)",
    "  --out      optional file to write the JSON report (default: stdout)",
  ].join("\n");
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--fixture" || a === "--db" || a === "--now" || a === "--out") {
      args[a.slice(2)] = argv[++i];
    } else if (a === "--help" || a === "-h") {
      args.help = true;
    } else {
      throw new Error(`unknown argument: ${a}\n${usage()}`);
    }
  }
  return args;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 2;
    return;
  }
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!args.fixture || !args.db || !args.now) {
    process.stderr.write(`missing required argument\n${usage()}\n`);
    process.exitCode = 2;
    return;
  }
  try {
    assertUtcIso(args.now, "--now");
  } catch (err) {
    process.stderr.write(`invalid --now: ${err.message}\n`);
    process.exitCode = 2;
    return;
  }

  let fixture;
  try {
    fixture = validateFixture(JSON.parse(readFileSync(args.fixture, "utf8")));
  } catch (err) {
    if (err instanceof TeamBrainError) {
      process.stderr.write(`fixture error [${err.code}]: ${err.message}\n`);
    } else {
      process.stderr.write(`fixture error: ${err.message}\n`);
    }
    process.exitCode = 2;
    return;
  }

  mkdirSync(args.db, { recursive: true });
  const db = new PGlite(args.db);
  try {
    // The fixture's trusted Jason authorization records are injected at
    // repository creation so overrides are authenticated at the write
    // boundary, in the same transaction as the filing.
    const repo = createRepository(db, { trustedAuthorizations: fixture.trustedAuthorizations || [] });
    await repo.migrate();
    const handoffs = createHandoffMachine(db);
    const report = await buildFixtureReport({
      repo,
      handoffs,
      fixture,
      now: args.now,
      fixtureName: basename(args.fixture),
    });
    const json = `${stableStringify(report)}\n`;
    if (args.out) {
      mkdirSync(dirname(args.out), { recursive: true });
      writeFileSync(args.out, json, "utf8");
    } else {
      process.stdout.write(json);
    }
  } catch (err) {
    if (err instanceof TeamBrainError) {
      process.stderr.write(`lifecycle error [${err.code}]: ${err.message}\n`);
    } else {
      process.stderr.write(`error: ${err && err.message}\n`);
    }
    process.exitCode = 3;
  } finally {
    await db.close();
  }
}

await main();
