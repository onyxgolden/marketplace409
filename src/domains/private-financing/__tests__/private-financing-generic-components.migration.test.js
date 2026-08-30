import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const raw = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260830000300_add_private_financing_v1_terms_generalization.sql"),
  "utf8",
);
const sql = raw.replace(/--[^\n]*/g, "").toLowerCase().replace(/\s+/g, " ");

describe("V1 terms generalization -- generic component identities", () => {
  it("removes the foundation's two-value component-row check and replaces it with non-empty generic keys", () => {
    expect(sql).toContain("drop constraint if exists private_financing_components_component_type_check");
    expect(sql).toContain("private_financing_components_component_key_check check (btrim(component_key) <> '')");
    expect(sql).toContain("unique (owner_id, account_id, component_key, version_number)");
  });

  it("removes the inherited ledger-event two-value check after renaming component_type", () => {
    expect(sql).toContain("rename column component_type to component_id");
    expect(sql).toContain("drop constraint if exists private_financing_events_component_type_check");
    expect(sql).toContain("private_financing_events_component_id_check check (component_id is null or btrim(component_id) <> '')");
  });

  it("never reintroduces interest_bearing/zero_interest as a closed component identity list", () => {
    const componentSection = sql.slice(
      sql.indexOf("alter table private_financing_components drop constraint"),
      sql.indexOf("create view private_financing_current_components"),
    );
    expect(componentSection).not.toContain("component_key in ('interest_bearing', 'zero_interest')");
  });
});
