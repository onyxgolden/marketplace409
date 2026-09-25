import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Static contract check for the Call Shield Slice B labels migration:
// the table/index are IF NOT EXISTS, policy creation is idempotent
// (reapplying the migration must not fail on existing policy names), and
// the owner-only policy expressions plus forced RLS are preserved exactly.
const sql = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260924110000_create_call_contact_labels.sql"),
  "utf8",
);
const lower = sql.toLowerCase();

const POLICIES = [
  "call_contact_labels_owner_select",
  "call_contact_labels_owner_insert",
  "call_contact_labels_owner_update",
  "call_contact_labels_owner_delete",
];

describe("call shield labels migration", () => {
  it("creates the table and index idempotently", () => {
    expect(lower).toContain("create table if not exists call_contact_labels");
    expect(lower).toContain("create index if not exists idx_call_contact_labels_owner_label");
    expect(lower).toMatch(/unique\s*\(\s*owner_id\s*,\s*normalized_phone\s*\)/);
  });

  it("keeps forced owner-only RLS", () => {
    expect(lower).toContain("enable row level security");
    expect(lower).toContain("force row level security");
    expect(lower).toContain("grant select, insert, update, delete on call_contact_labels to authenticated");
  });

  it("creates each policy idempotently without changing its expression", () => {
    for (const name of POLICIES) {
      // Idempotency guard: existence check against pg_policies (or an
      // equivalent drop-if-exists) must wrap the CREATE POLICY.
      const guarded = new RegExp(
        `(if not exists[\\s\\S]*?policyname\\s*=\\s*'${name}'[\\s\\S]*?create policy "${name}")` +
          `|(drop policy if exists "${name}"[\\s\\S]*?create policy "${name}")`,
      );
      expect(guarded.test(lower), `policy ${name} is not created idempotently`).toBe(true);
    }
    // Exact owner-only expressions preserved.
    for (const name of POLICIES) {
      const body = lower.match(new RegExp(`create policy "${name}"[\\s\\S]*?;`));
      expect(body, `missing policy ${name}`).toBeTruthy();
      expect(body[0]).toContain("owner_id = auth.uid()::text");
      expect(body[0]).toContain("to authenticated");
    }
  });

  it("keeps the label check constraint to personal/offender", () => {
    expect(lower).toMatch(/check\s*\(\s*label in\s*\('personal'\s*,\s*'offender'\)/);
  });
});
