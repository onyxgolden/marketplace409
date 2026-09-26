import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Static contract checks for the price-book table migration (the
// designer_projects workspace-access model + the explicit-grant contract).
const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260925190000_create_designer_price_books.sql"),
  "utf8",
)
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .toLowerCase();

describe("designer_price_books migration", () => {
  it("creates an owner-keyed table holding one jsonb object per book", () => {
    expect(sql).toContain("create table if not exists designer_price_books");
    expect(sql).toContain("primary key (owner_id, book_id)");
    expect(sql).toContain("book jsonb not null check (jsonb_typeof(book) = 'object')");
  });

  it("forces RLS and gates every verb on has_workspace_access(owner_id), never bare auth.uid()", () => {
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("force row level security");
    for (const verb of ["select", "insert", "update", "delete"]) {
      expect(sql).toContain(`"designer_price_books_owner_${verb}" on designer_price_books\n      for ${verb} to authenticated`);
    }
    expect(sql).not.toContain("auth.uid()");
    // select using, insert check, update using+check, delete using
    expect(sql.split("has_workspace_access(owner_id)").length - 1).toBe(5);
  });

  it("creates policies idempotently", () => {
    expect(sql.split("if not exists (\n    select 1 from pg_policies").length - 1).toBe(4);
  });

  it("grants minimally: authenticated CRUD, nothing for anon", () => {
    // Revoke defaults (Supabase grants ALL incl. TRUNCATE) before the positive grant.
    const revokeAt = sql.indexOf("revoke all on designer_price_books from anon, authenticated;");
    const grantAt = sql.indexOf("grant select, insert, update, delete on designer_price_books to authenticated;");
    expect(revokeAt).toBeGreaterThan(-1);
    expect(grantAt).toBeGreaterThan(revokeAt);
    expect(sql).toContain("grant select, insert, update, delete on designer_price_books to authenticated;");
    expect(sql).not.toMatch(/grant[^;]*to anon/);
    expect(sql).not.toContain("service_role");
  });

  it("is additive only", () => {
    expect(sql).not.toMatch(/\b(drop|alter table (?!designer_price_books))/);
  });
});
