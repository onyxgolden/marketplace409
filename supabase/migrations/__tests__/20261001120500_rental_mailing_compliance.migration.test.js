import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Static contract check for the R20 compliance-fixes migration (ChatGPT GO
// WITH FIXES): the mailed/delivered tracking-evidence check constraint and the
// rental_mail_letter_events audit table.
const sql = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261001120500_rental_mailing_compliance.sql"),
  "utf8",
);
const lower = sql.toLowerCase();

const POLICIES = [
  "rental_mail_letter_events_owner_select",
  "rental_mail_letter_events_owner_insert",
  "rental_mail_letter_events_owner_update",
  "rental_mail_letter_events_owner_delete",
];

describe("r20 mailing compliance migration", () => {
  it("enforces the certified-mail evidence invariant at the database level", () => {
    expect(lower).toContain("rental_mail_letters_tracking_required_for_mailed");
    expect(lower).toMatch(/check\s*\(\s*status not in\s*\(\s*'mailed'\s*,\s*'delivered'\s*\)/);
    expect(lower).toContain("tracking_number is not null");
  });

  it("creates the audit-events table idempotently", () => {
    expect(lower).toContain("create table if not exists rental_mail_letter_events");
    expect(lower).toMatch(/primary key\s*\(\s*owner_id\s*,\s*id\s*\)/);
    expect(lower).toContain("event_type in ('status_changed', 'tracking_set', 'tracking_changed', 'tracking_cleared')");
    expect(lower).toContain("create index if not exists idx_rental_mail_letter_events_letter");
  });

  it("keeps forced workspace-access RLS and the explicit-grant contract", () => {
    expect(lower).toContain("enable row level security");
    expect(lower).toContain("force row level security");
    expect(lower).toContain("revoke all on rental_mail_letter_events from anon, authenticated");
    expect(lower).toContain("grant select, insert, update, delete on rental_mail_letter_events to authenticated");
  });

  it("creates each policy idempotently", () => {
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
    }
  });
});
