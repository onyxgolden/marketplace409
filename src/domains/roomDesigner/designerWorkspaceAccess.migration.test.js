import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function stripSqlComments(sql) {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

// Comment-stripped, since this file's own explanatory comments quote the old
// auth.uid()::text pattern and must not trip the "no bare auth.uid()" checks.
const policySql = stripSqlComments(
  readFileSync(
    resolve(
      process.cwd(),
      "supabase/migrations/20260921080000_convert_designer_projects_policies_to_workspace_access.sql",
    ),
    "utf8",
  ).toLowerCase(),
);

describe("designer_projects workspace-access policy migration", () => {
  it("drops and recreates the owner policy by its existing name", () => {
    expect(policySql).toContain('drop policy "designer_projects_owner_all" on designer_projects;');
    expect(policySql).toContain(
      'create policy "designer_projects_owner_all" on designer_projects for all to authenticated',
    );
  });

  it("authorizes via has_workspace_access(owner_id) on using and with check, never bare auth.uid()", () => {
    expect(policySql).not.toContain("auth.uid()");
    const predicateCount = policySql.split("has_workspace_access(owner_id)").length - 1;
    // one in `using`, one in `with check`
    expect(predicateCount).toBe(2);
  });

  it("keeps the policy on the authenticated role only", () => {
    expect(policySql).toContain("to authenticated");
    expect(policySql).not.toContain("to public");
    expect(policySql).not.toContain("to anon");
  });
});
