import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function stripSqlComments(sql) {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

// Both the full text (with comments, for the "every policy renamed correctly" checks below, which
// want to see the real statements regardless of surrounding prose) and the comment-stripped text
// (for the "this migration does nothing else" checks, which would otherwise trip over this file's
// own explanatory comments quoting the old auth.uid()::text pattern or mentioning other tables by
// name for context).
const policySqlWithComments = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260908010000_convert_connection_platform_policies_to_workspace_access.sql"),
  "utf8",
).toLowerCase();
const policySql = stripSqlComments(policySqlWithComments);

const actorColumnSql = stripSqlComments(
  readFileSync(
    resolve(process.cwd(), "supabase/migrations/20260908020000_add_connection_execution_history_actor.sql"),
    "utf8",
  ).toLowerCase(),
);

const TABLES = ["connections", "credential_references", "institution_references", "credential_vault", "connection_execution_history"];
const OPERATIONS = ["select", "insert", "update", "delete"];

describe("connection platform workspace-access policy migration", () => {
  it("drops and recreates all 20 owner policies (5 tables x 4 operations), every one by its existing name", () => {
    for (const table of TABLES) {
      for (const operation of OPERATIONS) {
        const policyName = `${table}_owner_${operation}`;
        expect(policySql).toContain(`drop policy "${policyName}" on ${table};`);
        expect(policySql).toContain(`create policy "${policyName}" on ${table} for ${operation} to authenticated`);
      }
    }
  });

  it("every recreated policy predicate is has_workspace_access(owner_id), not bare auth.uid()", () => {
    // Every occurrence of "owner_id" in a using/with check clause is via the function call --
    // the literal string "auth.uid()::text" (the pattern being replaced) must not appear anywhere
    // in this migration at all.
    expect(policySql).not.toContain("auth.uid()::text");
    expect(policySql).not.toContain("auth.uid() = owner_id");
    const predicateCount = policySql.split("has_workspace_access(owner_id)").length - 1;
    // Per table: select(1) + insert(1) + update(2 -- using AND with check) + delete(1) = 5 policy
    // occurrences x 5 tables = 25 (comments already stripped out of policySql above).
    expect(predicateCount).toBe(25);
  });

  it("touches only the 5 connection-platform tables -- no unrelated FORGE domain policy is redefined", () => {
    // The header comment references other tables' names for context (what the earlier, separate
    // checkpoint already covered) -- what must never appear is an actual policy operation against
    // one of them.
    const otherTables = ["financial_accounts", "financial_events", "account_balances", "rental_payments", "private_financing_accounts", "schedule_projects"];
    for (const other of otherTables) {
      expect(policySql).not.toContain(`on ${other}`);
      expect(policySql).not.toContain(`drop policy "${other}`);
    }
  });

  it("is purely a policy swap -- no column added/dropped, no data rewritten, no new table", () => {
    expect(policySql).not.toContain("alter table");
    expect(policySql).not.toContain("insert into"); // a data insert, not "create policy ... for insert"
    expect(policySql).not.toContain(" set "); // an UPDATE ... SET data mutation
    expect(policySql).not.toContain("create table");
    expect(policySql).not.toContain("drop table");
    expect(policySql).not.toContain("truncate");
  });

  it("adds actor_user_id to connection_execution_history additively, with no backfill and no RLS change", () => {
    expect(actorColumnSql).toContain("alter table connection_execution_history");
    expect(actorColumnSql).toContain("add column if not exists actor_user_id text");
    expect(actorColumnSql).not.toContain("update connection_execution_history");
    expect(actorColumnSql).not.toContain("create policy");
    expect(actorColumnSql).not.toContain("drop policy");
    expect(actorColumnSql).not.toContain("not null");
  });
});
