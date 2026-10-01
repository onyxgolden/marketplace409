import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Structural contract for 20261001010000_owner_cash_movements.sql (Rentec-parity R9).
// This test never touches a database: it proves the migration text carries the
// owner-movements contract — the owner-scoped table with the same RLS shape as
// the other ledger tables, the disbursement/contribution kind constraint, and
// the void (not delete) state model that keeps the audit trail.
// The migration itself is NOT applied anywhere by this test.
//
// Note on matching: the migration file is lowercased and whitespace-normalized
// before matching (runs of whitespace collapse to one space, spaces after
// commas are KEPT). Expected strings below were verified character-by-character
// against the normalized file.
const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261001010000_owner_cash_movements.sql"),
  "utf8",
).toLowerCase().replace(/\s+/g, " ");

describe("owner cash movements migration — structural contract", () => {
  it("creates owner_cash_movements with the equity-movement columns", () => {
    expect(sql).toContain("create table if not exists owner_cash_movements");
    expect(sql).toContain("owner_id text not null");
    expect(sql).toContain("property_id text");
    expect(sql).toContain("kind text not null check (kind in ('disbursement', 'contribution'))");
    expect(sql).toContain("amount numeric not null check (amount > 0)");
    expect(sql).toContain("movement_date date not null");
    expect(sql).toContain("memo text not null default ''");
    expect(sql).toContain("status text not null default 'active' check (status in ('active', 'voided'))");
    expect(sql).toContain("voided_at timestamptz");
    expect(sql).toContain("voided_by text");
  });

  it("enforces the void-state invariant: active has no voided_at, voided requires one", () => {
    expect(sql).toContain("constraint owner_cash_movements_void_state_check");
    expect(sql).toContain("status = 'active' and voided_at is null");
    expect(sql).toContain("status = 'voided' and voided_at is not null");
  });

  it("gives owner_cash_movements the same owner-scoped RLS shape as the ledger tables", () => {
    expect(sql).toContain("alter table owner_cash_movements enable row level security");
    expect(sql).toContain("alter table owner_cash_movements force row level security");
    expect(sql).toContain("owner_cash_movements_owner_select");
    expect(sql).toContain("owner_cash_movements_owner_insert");
    expect(sql).toContain("owner_cash_movements_owner_update");
    expect(sql).toContain("owner_cash_movements_owner_delete");
    expect(sql).toContain("using (has_workspace_access(owner_id))");
  });

  it("indexes the owner, the owner+date read path, and the property column", () => {
    expect(sql).toContain("create index if not exists idx_owner_cash_movements_owner");
    expect(sql).toContain("create index if not exists idx_owner_cash_movements_owner_date");
    expect(sql).toContain("create index if not exists idx_owner_cash_movements_property");
  });

  it("keeps contributions out of financial_events: the table is the contribution home", () => {
    // A contribution recorded anywhere else could show up as income on a
    // report; assert the migration wires no financial_events plumbing.
    // Header comments (which document the deliberate separation) are stripped
    // first so the assertion only sees executable SQL.
    const ddlOnly = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20261001010000_owner_cash_movements.sql"),
      "utf8",
    )
      .toLowerCase()
      .split("\n")
      .map((line) => line.replace(/--.*$/, ""))
      .join("\n");
    expect(ddlOnly).not.toContain("financial_events");
  });
});
