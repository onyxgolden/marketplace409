import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Guards against the exact live-only bug this migration fixes: `returns table(board_revision
// bigint, ...)` implicitly declares `board_revision` as a PL/pgSQL variable for the whole
// function body, so an unqualified reference to it inside an expression (not an UPDATE SET
// target, which is always the column) is ambiguous and fails at runtime -- a class of defect a
// static text check normally can't catch, caught here only because we know the exact broken
// pattern to forbid. Found by running supabase/validation/
// schedule_atomic_save_and_preserve_relational_data_validation.sql against production immediately
// after the original migration shipped -- every real save failed with Postgres error 42702 until
// this fix landed.
const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260907020000_fix_save_schedule_project_board_ambiguous_board_revision.sql"), "utf8").toLowerCase().replace(/\s+/g, " ");
// Isolates the actual function body from the header comment above it, which -- for
// documentation -- quotes the exact broken pattern this migration removes. Checking the whole
// file would make the "no bare reference" assertion below false-positive against that quote.
const functionBody = sql.slice(sql.indexOf("create or replace function save_schedule_project_board"));

describe("fix save_schedule_project_board ambiguous board_revision migration", () => {
  it("qualifies board_revision in the revision-bump expression with its table alias, not a bare reference", () => {
    expect(functionBody).toContain("coalesce(sp.board_revision, 0)");
    expect(functionBody).not.toMatch(/coalesce\(\s*board_revision\s*,/);
  });

  it("re-declares the exact same signature (create or replace, not a new function name)", () => {
    expect(sql).toContain("create or replace function save_schedule_project_board(");
    expect(sql).toContain("returns table(board_revision bigint, updated_at timestamptz)");
  });

  it("still enforces ownership and optimistic concurrency -- this is a targeted fix, not a rewrite that could silently drop a guard", () => {
    expect(sql).toContain("raise exception 'schedule_save_not_found'");
    expect(sql).toContain("raise exception 'schedule_save_conflict'");
    expect(sql).toContain("for update");
  });

  it("still calls the non-destructive sync function inside the same transaction", () => {
    expect(sql).toContain("perform sync_schedule_project_from_board(p_owner_id, p_project_id)");
  });
});
