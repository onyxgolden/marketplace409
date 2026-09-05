import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260905000000_create_scheduling_resources_and_costs.sql"), "utf8").toLowerCase().replace(/\s+/g, " ");

const OWNER_SCOPED_TABLES = ["schedule_resources", "schedule_cost_accounts", "schedule_resource_assignments", "schedule_expenses"];

function tableSql(table) {
  const start = sql.indexOf(`create table if not exists ${table}`);
  const end = sql.indexOf(";", start);
  return sql.slice(start, end);
}

describe("scheduling resources and costs migration", () => {
  it("creates all four new tables", () => {
    for (const table of OWNER_SCOPED_TABLES) {
      expect(sql).toContain(`create table if not exists ${table}`);
    }
  });

  it("gives every new table a composite (owner_id, id) primary key and force RLS with an owner-scoped policy, no public-select", () => {
    for (const table of OWNER_SCOPED_TABLES) {
      const thisTableSql = tableSql(table);
      expect(thisTableSql).toContain("owner_id text not null");
      expect(thisTableSql).toContain("primary key (owner_id, id)");

      expect(sql).toContain(`alter table ${table} enable row level security`);
      expect(sql).toContain(`alter table ${table} force row level security`);
      expect(sql).toContain(`create policy "${table}_owner_all" on ${table} for all to authenticated using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text)`);
      expect(sql).not.toContain(`${table}_public_select`);
    }
  });

  it("restricts resource_type to labor, nonlabor, or material -- no Roles concept in v1", () => {
    const thisTableSql = tableSql("schedule_resources");
    expect(thisTableSql).toContain("resource_type text not null check (resource_type in ('labor', 'nonlabor', 'material'))");
    expect(thisTableSql).toContain("max_units_per_day numeric not null default 8 check (max_units_per_day > 0)");
    expect(thisTableSql).toContain("unique (owner_id, name)");
  });

  it("keeps schedule_cost_accounts flat -- no parent_id column, unlike schedule_wbs_nodes", () => {
    const thisTableSql = tableSql("schedule_cost_accounts");
    expect(thisTableSql).not.toContain("parent_id");
    expect(thisTableSql).toContain("unique (owner_id, code)");
  });

  it("cascades schedule_resource_assignments off its block but restricts deleting a resource still in use", () => {
    const thisTableSql = tableSql("schedule_resource_assignments");
    expect(thisTableSql).toContain("foreign key (owner_id, block_id) references schedule_blocks(owner_id, id) on delete cascade");
    expect(thisTableSql).toContain("foreign key (owner_id, resource_id) references schedule_resources(owner_id, id) on delete restrict");
    expect(thisTableSql).toContain("unique (owner_id, block_id, resource_id)");
  });

  it("gives schedule_expenses a uniform-by-default accrual type constrained to start/end/uniform", () => {
    const thisTableSql = tableSql("schedule_expenses");
    expect(thisTableSql).toContain("accrual_type text not null default 'uniform' check (accrual_type in ('start', 'end', 'uniform'))");
    expect(thisTableSql).toContain("foreign key (owner_id, block_id) references schedule_blocks(owner_id, id) on delete cascade");
  });

  it("never deletes any existing table or data", () => {
    expect(sql).not.toContain("drop table");
    expect(sql).not.toContain("delete from");
  });
});
