// HP-L4 migration contract, checked statically (no docker needed).
//
// The house_plans_regulatory_snapshots table is DDL-only: this test asserts
// the migration file itself carries the immutable snapshot model -- factual
// metadata entries as a JSONB array, a content hash, RLS on the workspace
// access pattern, no seed rows, and no mutation statements.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../20260921130000_create_house_plans_regulatory_snapshots.sql"
);
const sql = fs.readFileSync(migrationPath, "utf8");

describe("20260921130000_create_house_plans_regulatory_snapshots (HP-L4, static)", () => {
  it("creates the house_plans_regulatory_snapshots table", () => {
    expect(sql).toMatch(/create table if not exists house_plans_regulatory_snapshots/i);
  });

  it("defines exactly the snapshot columns", () => {
    for (const column of [
      "owner_id",
      "label",
      "entries",
      "content_hash",
      "captured_at",
    ]) {
      expect(sql).toMatch(new RegExp(`(^|\\n)\\s*${column}\\s`, "i"));
    }
  });

  it("stores entries as a JSONB array with a non-empty content hash", () => {
    expect(sql).toMatch(/entries jsonb not null check \(jsonb_typeof\(entries\) = 'array'\)/i);
    expect(sql).toMatch(/content_hash text not null check \(char_length\(content_hash\) > 0\)/i);
  });

  it("has no summary/content/explanation columns", () => {
    for (const banned of ["summary", "content", "description", "explanation", "paraphrase", "interpretation"]) {
      expect(sql).not.toMatch(new RegExp(`(^|\\n)\\s*${banned}\\s+text`, "i"));
    }
  });

  it("enables and forces row level security", () => {
    expect(sql).toMatch(/alter table house_plans_regulatory_snapshots enable row level security/i);
    expect(sql).toMatch(/alter table house_plans_regulatory_snapshots force row level security/i);
  });

  it("is append-only at the RLS boundary: SELECT + INSERT policies only", () => {
    // Immutability must hold at the persistence boundary, not just in the
    // application layer: with RLS enabled and forced, the absence of
    // UPDATE/DELETE policies means no authenticated session can mutate or
    // remove a historical snapshot through any path.
    expect(sql).toMatch(/create policy "house_plans_regulatory_snapshots_select"/i);
    expect(sql).toMatch(/create policy "house_plans_regulatory_snapshots_insert"/i);
    expect(sql).toMatch(/for select/i);
    expect(sql).toMatch(/for insert/i);
    // No UPDATE, DELETE, or FOR ALL policy anywhere: with RLS enabled and
    // forced, that absence is what makes the table append-only.
    expect(sql).not.toMatch(/for all/i);
    expect(sql).not.toMatch(/for update/i);
    expect(sql).not.toMatch(/for delete/i);
  });

  it("documents the immutable, append-only contract", () => {
    expect(sql).toMatch(/immutable/i);
    expect(sql).toMatch(/append-only/i);
    expect(sql).toMatch(/never silently rewrites/i);
  });

  it("ships with no seed rows and no mutation statements", () => {
    expect(sql).not.toMatch(/insert\s+into/i);
    expect(sql).not.toMatch(/update\s+house_plans_regulatory_snapshots/i);
    expect(sql).not.toMatch(/delete\s+from\s+house_plans_regulatory_snapshots/i);
  });
});
