import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Static contract check for the Call Shield S2 persistence migration:
// owner-only RLS everywhere, append-only event timeline (no update/delete
// policies), write-once evidence descriptors (no update), design-only
// sharing table with no grantee policies, private evidence bucket whose
// object policies are scoped to the owner's own folder.
const sql = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260923160000_create_call_shield_tables.sql"),
  "utf8",
);
const lower = sql.toLowerCase();

function policyBody(name) {
  const match = lower.match(new RegExp(`create policy "${name}"[\\s\\S]*?;`));
  expect(match, `missing policy ${name}`).toBeTruthy();
  return match[0];
}

describe("call shield persistence migration", () => {
  it("creates the four tables with client-generated uuid ids", () => {
    for (const t of ["call_shield_cases", "call_shield_case_events", "call_shield_evidence", "call_shield_case_access"]) {
      expect(lower).toContain(`create table if not exists ${t}`);
      expect(lower).toContain("enable row level security");
    }
    expect(lower.match(/create table if not exists call_shield_cases[\s\S]*?id uuid primary key/)).toBeTruthy();
    expect(lower.match(/create table if not exists call_shield_case_events[\s\S]*?id uuid primary key/)).toBeTruthy();
  });

  it("keeps the event timeline append-only (select + insert policies only)", () => {
    for (const op of ["select", "insert"]) {
      expect(policyBody(`call_shield_case_events_owner_${op}`)).toContain("owner_id = auth.uid()::text");
    }
    expect(lower).not.toContain("call_shield_case_events_owner_update");
    expect(lower).not.toContain("call_shield_case_events_owner_delete");
    expect(lower).toContain("grant select, insert on call_shield_case_events to authenticated");
  });

  it("keeps evidence descriptors write-once (no update policy)", () => {
    for (const op of ["select", "insert", "delete"]) {
      expect(policyBody(`call_shield_evidence_owner_${op}`)).toContain("owner_id = auth.uid()::text");
    }
    expect(lower).not.toContain("call_shield_evidence_owner_update");
  });

  it("mirrors the S1 domain evidence kind and MIME allowlists", () => {
    for (const kind of ["audio_recording", "call_log_screenshot", "voicemail", "text_message", "document", "other"]) {
      expect(lower).toContain(`'${kind}'`);
    }
    for (const mime of ["audio/mpeg", "audio/mp4", "audio/webm", "image/jpeg", "image/png", "application/pdf", "text/plain"]) {
      expect(lower).toContain(`'${mime}'`);
    }
    expect(lower).toMatch(/sha256 text not null check \(sha256 ~ '\^\[0-9a-fa-f\]\{64\}\$'\)/);
  });

  it("designs the sharing table with no grantee-side access in Phase 1", () => {
    expect(lower).toContain("create table if not exists call_shield_case_access");
    expect(lower).toContain("check (grantee_type in ('user', 'attorney'))");
    expect(lower).toContain("check (permission in ('viewer', 'exporter'))");
    expect(lower).toContain("where revoked_at is null");
    // Owner-managed rows only; no policy grants a grantee access.
    const granteePolicy = lower.match(/create policy "call_shield_case_access_\w+" on call_shield_case_access[\s\S]*?;/g) || [];
    expect(granteePolicy).toHaveLength(3);
    for (const p of granteePolicy) {
      expect(p).toContain("owner_id = auth.uid()::text");
    }
    expect(lower).not.toMatch(/grantee_id\s*=\s*auth\.uid/);
  });

  it("creates a private evidence bucket scoped to the owner's own folder", () => {
    expect(lower).toContain("insert into storage.buckets");
    expect(lower).toContain("'call-shield-evidence'");
    expect(lower).toMatch(/public\s*,\s*false|public\s*=\s*false/);
    expect(lower).not.toMatch(/public\s*,?\s*=\s*,?\s*true/);
    const matches = lower.match(/create policy "call_shield_evidence_objects_owner_\w+" on storage\.objects/g);
    expect(matches).toHaveLength(3);
    for (const m of matches) {
      const body = lower.slice(lower.indexOf(m), lower.indexOf(m) + 400);
      expect(body).toContain("bucket_id = 'call-shield-evidence'");
      expect(body).toContain("(storage.foldername(name))[1] = auth.uid()::text");
    }
  });

  it("stores no legal conclusions in any table", () => {
    expect(lower).not.toMatch(/violation/i);
    expect(lower).not.toMatch(/claim_valid|damages/i);
    expect(lower).not.toMatch(/\$\s*1,?500/);
  });
});
