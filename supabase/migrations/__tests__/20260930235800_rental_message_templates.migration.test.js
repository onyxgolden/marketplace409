import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Static contract check for the Rentec-parity R6 message-templates migration:
// the table/index are IF NOT EXISTS, policy creation is idempotent
// (drop-if-exists guards every policy so reapplying the migration never
// fails), the workspace-access policy expressions plus forced RLS are
// preserved exactly, and the kind/audience/system invariants hold.
const sql = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260930235800_rental_message_templates.sql"),
  "utf8",
);
const lower = sql.toLowerCase();

const POLICIES = [
  "rental_message_templates_owner_select",
  "rental_message_templates_owner_insert",
  "rental_message_templates_owner_update",
  "rental_message_templates_owner_delete",
];

describe("r6 message templates migration", () => {
  it("creates the table and index idempotently", () => {
    expect(lower).toContain("create table if not exists rental_message_templates");
    expect(lower).toContain("create index if not exists idx_rental_message_templates_owner_kind_audience");
    expect(lower).toMatch(/primary key\s*\(\s*owner_id\s*,\s*id\s*\)/);
    expect(lower).toMatch(/unique\s*\(\s*owner_id\s*,\s*system_key\s*\)/);
  });

  it("keeps forced workspace-access RLS and the explicit-grant contract", () => {
    expect(lower).toContain("enable row level security");
    expect(lower).toContain("force row level security");
    expect(lower).toContain("revoke all on rental_message_templates from anon, authenticated");
    expect(lower).toContain("grant select, insert, update, delete on rental_message_templates to authenticated");
  });

  it("creates each policy idempotently without changing its expression", () => {
    for (const name of POLICIES) {
      const guarded = new RegExp(
        `drop policy if exists "${name}"[\\s\\S]*?create policy "${name}"`,
      );
      expect(guarded.test(lower), `policy ${name} is not created idempotently`).toBe(true);
    }
    for (const name of POLICIES) {
      const body = lower.match(new RegExp(`create policy "${name}"[\\s\\S]*?;`));
      expect(body, `missing policy ${name}`).toBeTruthy();
      expect(body[0]).toContain("has_workspace_access(owner_id)");
      expect(body[0]).toContain("to authenticated");
    }
  });

  it("constrains kind, audience, and the system-template invariants", () => {
    expect(lower).toMatch(/kind in\s*\(\s*'email'\s*,\s*'text'\s*,\s*'mailing'\s*\)/);
    expect(lower).toMatch(/audience in\s*\(\s*'tenant'\s*,\s*'owner'\s*\)/);
    // System rows must carry a system_key (the lazy-seed upsert target); an
    // email template must carry a subject.
    expect(lower).toContain("is_system = false or system_key is not null");
    expect(lower).toContain("kind <> 'email' or");
  });
});
