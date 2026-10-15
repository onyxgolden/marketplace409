// Team Brain slice 1 — schema snapshot test.
// Regenerates migrations/schema.snapshot.md from the migration SQL applied to
// a fresh in-memory PGlite and requires a byte-for-byte match with the
// checked-in file. The snapshot is therefore proof of the migration's
// contents, never a hand-written claim.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTempDirs } from "./helpers.mjs";

// PGlite WASM startup is slow under parallel workers; allow 30s per test.
const it30 = (name, fn) => it(name, fn, 30000);
import { generateSchemaSnapshot } from "../report/generateSchemaSnapshot.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("schema snapshot", () => {
  afterAll(cleanupTempDirs);
  it30("the checked-in snapshot matches the migration applied to a fresh database", async () => {
    const sql = readFileSync(join(HERE, "..", "migrations", "001_team_brain_schema.sql"), "utf8");
    const db = new PGlite();
    try {
      await db.exec(sql);
      const regenerated = `${await generateSchemaSnapshot(db)}\n`;
      const checkedIn = readFileSync(join(HERE, "..", "migrations", "schema.snapshot.md"), "utf8");
      expect(regenerated).toBe(checkedIn);
    } finally {
      await db.close();
    }
  });

  it30("the migration is idempotent (safe to re-apply)", async () => {
    const sql = readFileSync(join(HERE, "..", "migrations", "001_team_brain_schema.sql"), "utf8");
    const db = new PGlite();
    try {
      await db.exec(sql);
      await db.exec(sql);
      const v = await db.query("select count(*) c from team_brain_schema_version where version = 1");
      expect(Number(v.rows[0].c)).toBe(1);
    } finally {
      await db.close();
    }
  });
});
