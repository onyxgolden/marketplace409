import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Static contract check for the Rung 5 capture-library migration:
// table shape, RLS on all four operations tied to auth.uid(), private
// bucket, metadata-only audit log with upload/delete actions only.
const sql = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260922040007_capture_library.sql"),
  "utf8",
);
const lower = sql.toLowerCase();

describe("capture library migration", () => {
  it("creates the capture_library table with the idempotency-friendly shape", () => {
    expect(lower).toContain("create table if not exists capture_library");
    expect(lower).toContain("id uuid primary key");
    expect(lower).toContain("owner_id text not null");
    expect(lower).toContain("kind text not null check (kind in ('screenshot', 'recording'))");
    expect(lower).toContain("storage_path text not null");
    expect(lower).toContain("created_at timestamptz not null default now()");
  });

  it("enforces RLS on all four operations tied to auth.uid()", () => {
    expect(lower).toContain("alter table capture_library enable row level security");
    expect(lower).toContain("alter table capture_library force row level security");
    for (const op of ["select", "insert", "update", "delete"]) {
      const policy = lower.match(new RegExp(`create policy "capture_library_owner_${op}"[\\s\\S]*?;`));
      expect(policy, `missing policy for ${op}`).toBeTruthy();
      expect(policy[0]).toContain("owner_id = auth.uid()::text");
    }
  });

  it("creates a private capture-library bucket with a 25 MB cap and no public access", () => {
    expect(lower).toContain("insert into storage.buckets");
    expect(lower).toContain("'capture-library'");
    expect(lower).toContain("26214400");
    expect(lower).toMatch(/public\s*,\s*false|public=false/);
    expect(lower).not.toMatch(/public\s*,\s*true|public=true/);
  });

  it("scopes storage object access to the owner's own folder", () => {
    const matches = lower.match(/create policy "capture_library_objects_owner_\w+" on storage\.objects/g);
    expect(matches).toHaveLength(3);
    for (const m of matches) {
      const start = lower.indexOf(m);
      const body = lower.slice(start, start + 400);
      expect(body).toContain("bucket_id='capture-library'");
      expect(body).toContain("(storage.foldername(name))[1]=auth.uid()::text");
    }
  });

  it("keeps an append-only metadata-only audit log with upload/delete actions only", () => {
    expect(lower).toContain("create table if not exists capture_library_audit_log");
    expect(lower).toContain("action text not null check (action in ('uploaded', 'deleted'))");
    expect(lower).not.toContain("'shared'");
    expect(lower).not.toContain("'share'");
    // No foreign key to capture_library: delete events must survive the row's deletion.
    expect(lower).not.toMatch(/references\s+capture_library/);
    const policies = lower.match(/create policy "capture_library_audit_log_owner_\w+"/g);
    expect(policies).toHaveLength(2); // select + insert; no update/delete grant
  });
});
