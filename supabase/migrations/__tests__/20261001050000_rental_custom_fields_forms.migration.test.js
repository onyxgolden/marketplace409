import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Static contract check for the Rentec-parity R15 custom-fields/forms
// migration: the tables/indexes are IF NOT EXISTS, policy creation is
// idempotent (drop-if-exists guards every policy so reapplying the
// migration never fails), the workspace-access policy expressions plus
// forced RLS are preserved exactly, and the entity/type/kind invariants
// hold.
const sql = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261001050000_rental_custom_fields_forms.sql"),
  "utf8",
);
const lower = sql.toLowerCase();

const TABLES = [
  "rental_custom_fields",
  "rental_custom_field_values",
  "rental_custom_forms",
  "rental_notice_log",
];

const POLICIES = [
  "rental_custom_fields_owner_select",
  "rental_custom_fields_owner_insert",
  "rental_custom_fields_owner_update",
  "rental_custom_fields_owner_delete",
  "rental_custom_field_values_owner_select",
  "rental_custom_field_values_owner_insert",
  "rental_custom_field_values_owner_update",
  "rental_custom_field_values_owner_delete",
  "rental_custom_forms_owner_select",
  "rental_custom_forms_owner_insert",
  "rental_custom_forms_owner_update",
  "rental_custom_forms_owner_delete",
  "rental_notice_log_owner_select",
  "rental_notice_log_owner_insert",
  "rental_notice_log_owner_update",
  "rental_notice_log_owner_delete",
];

describe("r15 custom fields/forms migration", () => {
  it("creates all four tables and indexes idempotently", () => {
    for (const table of TABLES) {
      expect(lower).toContain(`create table if not exists ${table}`);
    }
    expect(lower).toContain("create index if not exists idx_rental_custom_fields_owner_entity");
    expect(lower).toContain("create index if not exists idx_rental_custom_field_values_owner_field");
    expect(lower).toContain("create index if not exists idx_rental_custom_forms_owner_kind");
    expect(lower).toContain("create index if not exists idx_rental_notice_log_owner_tenant");
  });

  it("keeps the key constraints idempotent and additive", () => {
    expect(lower).toMatch(/primary key\s*\(\s*owner_id\s*,\s*id\s*\)/);
    expect(lower).toMatch(/unique\s*\(\s*owner_id\s*,\s*entity\s*,\s*name\s*\)/);
    expect(lower).toMatch(/unique\s*\(\s*owner_id\s*,\s*system_key\s*\)/);
    expect(lower).toMatch(/primary key\s*\(\s*owner_id\s*,\s*field_id\s*,\s*record_id\s*\)/);
    expect(lower).toContain("on delete cascade");
  });

  it("enforces the entity/type/kind value sets in SQL", () => {
    expect(lower).toMatch(/check\s*\(\s*entity in\s*\('tenant',\s*'lease',\s*'property',\s*'unit'\)/);
    expect(lower).toMatch(/check\s*\(\s*field_type in\s*\('text',\s*'number',\s*'date',\s*'yes_no',\s*'picklist'\)/);
    expect(lower).toMatch(/check\s*\(\s*kind in\s*\('notice',\s*'form'\)/);
  });

  it("keeps forced workspace-access RLS and the explicit-grant contract", () => {
    expect(lower).toContain("enable row level security");
    expect(lower).toContain("force row level security");
    for (const table of TABLES) {
      expect(lower).toContain(`revoke all on ${table} from anon, authenticated`);
      expect(lower).toContain(`grant select, insert, update, delete on ${table} to authenticated`);
    }
  });

  it("creates each policy idempotently without changing its expression", () => {
    for (const name of POLICIES) {
      const guarded = new RegExp(`drop policy if exists "${name}"`);
      expect(lower).toMatch(guarded);
      expect(lower).toContain(`create policy "${name}"`);
    }
    const sqlWithoutComments = lower.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
    const workspaceAccessCount = (sqlWithoutComments.match(/has_workspace_access\(owner_id\)/g) || []).length;
    expect(workspaceAccessCount).toBe(POLICIES.length + 4); // select+insert+update(2)+delete per table
  });
});
