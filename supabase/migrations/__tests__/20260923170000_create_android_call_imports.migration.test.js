import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Static contract check for the Slice A import-staging migration:
// imports land in a staging table first (never directly as timeline
// events), dedupe is enforced per owner, and raw numbers stay owner-only.
const sql = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260923170000_create_android_call_imports.sql"),
  "utf8",
);
const lower = sql.toLowerCase();

describe("android call imports migration", () => {
  it("creates the staging table with a per-owner dedupe hash", () => {
    expect(lower).toContain("create table if not exists android_call_imports");
    expect(lower).toContain("dedupe_hash text not null");
    expect(lower).toContain("unique (owner_id, dedupe_hash)");
    expect(lower).toContain("normalized_phone text not null");
  });

  it("enforces owner-only RLS on all four operations and forces RLS", () => {
    expect(lower).toContain("alter table android_call_imports enable row level security");
    expect(lower).toContain("alter table android_call_imports force row level security");
    for (const op of ["select", "insert", "update", "delete"]) {
      const match = lower.match(new RegExp(`create policy "android_call_imports_owner_${op}"[\\s\\S]*?;`));
      expect(match, `missing policy for ${op}`).toBeTruthy();
      expect(match[0]).toContain("owner_id = auth.uid()::text");
    }
  });

  it("constrains call types to the known CallLog set", () => {
    for (const t of ["incoming", "outgoing", "missed", "rejected", "blocked", "other"]) {
      expect(lower).toContain(`'${t}'`);
    }
  });

  it("references cases weakly so imports survive case deletion", () => {
    expect(lower).toMatch(/matched_case_id uuid references call_shield_cases\(id\) on delete set null/);
  });

  it("never writes directly to the event timeline", () => {
    const codeOnly = lower.replace(/--[^\n]*/g, "");
    expect(codeOnly).not.toContain("call_shield_case_events");
  });

  it("stores no legal conclusions", () => {
    expect(lower).not.toMatch(/violation|damages|claim_valid/i);
  });
});
