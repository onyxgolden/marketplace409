#!/usr/bin/env node
// Team Brain slice 1 — schema snapshot CLI (local only).
//   node scripts/team-brain/report/generateSchemaSnapshot.mjs --out <path>
// Applies the migration to an in-memory PGlite and writes the deterministic
// schema snapshot. Used once per schema change; the test pins the file.

import { writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { generateSchemaSnapshot } from "./generateSchemaSnapshot.mjs";

const outIdx = process.argv.indexOf("--out");
if (outIdx === -1 || !process.argv[outIdx + 1]) {
  process.stderr.write("usage: node scripts/team-brain/report/generateSchemaSnapshot.mjs --out <path>\n");
  process.exit(2);
}
const db = new PGlite();
await db.exec(readFileSync(new URL("../migrations/001_team_brain_schema.sql", import.meta.url), "utf8"));
const snapshot = await generateSchemaSnapshot(db);
await db.close();
writeFileSync(process.argv[outIdx + 1], `${snapshot}\n`, "utf8");
process.stdout.write(`wrote ${process.argv[outIdx + 1]}\n`);
