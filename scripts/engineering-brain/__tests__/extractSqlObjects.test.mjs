import { describe, expect, it } from "vitest";
import { extractSqlObjects } from "../extractSqlObjects.mjs";

describe("extractSqlObjects (SQL-object extraction)", () => {
  it("extracts a table, a policy, and a trigger from a single migration", () => {
    const migrations = [{
      path: "0001_init.sql",
      content: `
        create table if not exists widgets (id text primary key, owner_id text not null);
        create policy "widgets_owner_all" on widgets for all to authenticated using (owner_id = auth.uid()::text);
        create trigger widgets_touch_updated_at before update on widgets for each row execute function touch_updated_at();
      `,
    }];
    const objects = extractSqlObjects(migrations);
    expect(objects.map((o) => o.objectType).sort()).toEqual(["rls_policy", "table", "trigger"]);
    expect(objects.find((o) => o.objectType === "table").key).toBe("widgets");
    expect(objects.find((o) => o.objectType === "rls_policy").key).toBe("widgets.widgets_owner_all");
    expect(objects.find((o) => o.objectType === "trigger").key).toBe("widgets.widgets_touch_updated_at");
  });

  it("resolves the CURRENT effective definition when a later migration drops and recreates a policy", () => {
    const migrations = [
      { path: "0001_init.sql", content: `create policy "widgets_owner_all" on widgets for all to authenticated using (owner_id = auth.uid()::text);` },
      { path: "0002_workspace.sql", content: `drop policy "widgets_owner_all" on widgets;\ncreate policy "widgets_owner_all" on widgets for all to authenticated using (has_workspace_access(owner_id));` },
    ];
    const objects = extractSqlObjects(migrations);
    const policy = objects.find((o) => o.key === "widgets.widgets_owner_all");
    expect(policy.definition).toContain("has_workspace_access");
    expect(policy.definition).not.toContain("auth.uid()::text");
    expect(policy.sourcePath).toBe("0002_workspace.sql");
  });

  it("a policy dropped with no later recreate is excluded from current state entirely", () => {
    const migrations = [
      { path: "0001_init.sql", content: `create policy "temp_policy" on widgets for all to authenticated using (true);` },
      { path: "0002_cleanup.sql", content: `drop policy "temp_policy" on widgets;` },
    ];
    const objects = extractSqlObjects(migrations);
    expect(objects.find((o) => o.key === "widgets.temp_policy")).toBeUndefined();
  });

  it("treats same-named functions with different argument types as distinct objects (overloads)", () => {
    const migrations = [{
      path: "0001_helpers.sql",
      content: `
        create or replace function has_workspace_access(p_owner_id text)
        returns boolean language sql as $$ select true; $$;

        create or replace function has_workspace_access(p_owner_id uuid)
        returns boolean language sql as $$ select true; $$;
      `,
    }];
    const objects = extractSqlObjects(migrations);
    const functionKeys = objects.filter((o) => o.objectType === "rpc_function").map((o) => o.key).sort();
    expect(functionKeys).toEqual(["has_workspace_access(text)", "has_workspace_access(uuid)"]);
  });

  it("does not let a semicolon inside a dollar-quoted function body split the statement early", () => {
    const migrations = [{
      path: "0001_fn.sql",
      content: `
        create or replace function noisy_body(p_x text)
        returns text language plpgsql as $function$
        begin
          if p_x is null then raise exception 'x is required'; end if;
          return p_x;
        end;
        $function$;
      `,
    }];
    const objects = extractSqlObjects(migrations);
    const fn = objects.find((o) => o.objectType === "rpc_function");
    expect(fn.key).toBe("noisy_body(text)");
    expect(fn.definition).toContain("end;");
    expect(fn.definition.trim().endsWith("$function$;")).toBe(true);
  });

  it("supersedes a create-or-replace function with a later create-or-replace under the same signature", () => {
    const migrations = [
      { path: "0001.sql", content: `create or replace function greet(p_name text) returns text language sql as $$ select 'hi ' || p_name; $$;` },
      { path: "0002.sql", content: `create or replace function greet(p_name text) returns text language sql as $$ select 'hello ' || p_name; $$;` },
    ];
    const objects = extractSqlObjects(migrations);
    const fn = objects.find((o) => o.key === "greet(text)");
    expect(fn.definition).toContain("hello");
    expect(fn.definition).not.toContain("'hi '");
    expect(fn.sourcePath).toBe("0002.sql");
  });
});
