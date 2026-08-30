import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL("../../../../supabase/migrations/20260830000800_add_atomic_private_financing_historical_import.sql", import.meta.url),
  "utf8",
);

describe("atomic historical financing import migration", () => {
  it("is generic, authorized, atomic, and duplicate protected", () => {
    expect(sql).toMatch(/primary key \(owner_id, source_key\)/i);
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/set row_security = off/i);
    expect(sql).toMatch(/has_workspace_access\(p_owner_id\)/i);
    expect(sql).toMatch(/pg_advisory_xact_lock/i);
    expect(sql).toMatch(/'status', 'already_imported'/i);
    expect(sql).toMatch(/open_private_financing_account\(/i);
    expect(sql.match(/append_private_financing_event\(/gi)).toHaveLength(2);
  });

  it("uses immutable, idempotent imported events and no customer constants", () => {
    expect(sql).toMatch(/p_event_type := 'payment_posted'/i);
    expect(sql).toMatch(/p_event_type := 'principal_correction'/i);
    expect(sql).toMatch(/p_event_origin := 'manual_import'/gi);
    expect(sql).toMatch(/p_source_key \|\| ':payment:' \|\|/i);
    expect(sql).toMatch(/p_source_key \|\| ':credit:' \|\|/i);
    expect(sql).not.toMatch(/update public\.private_financing_events/i);
    expect(sql).not.toMatch(/delete from public\.private_financing_events/i);
    expect(sql.toLowerCase()).not.toContain("south main");
    expect(sql).not.toContain("138690");
    expect(sql).not.toContain("3184347");
  });

  it("does not grant browser write access to the import receipt table", () => {
    expect(sql).toMatch(/revoke insert, update, delete[\s\S]*from authenticated/i);
    expect(sql).toMatch(/grant select[\s\S]*to authenticated/i);
    expect(sql).not.toMatch(/grant (?:all|insert|update|delete)[\s\S]*to authenticated/i);
  });
});
