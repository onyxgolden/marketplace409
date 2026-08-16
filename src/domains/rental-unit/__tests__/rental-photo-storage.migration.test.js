import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(join(process.cwd(), "supabase/migrations/20260816001500_add_rental_photo_storage.sql"), "utf8");

describe("rental photo storage migration", () => {
  it("creates a private rental-photos bucket limited to image types and 5MB", () => {
    expect(sql).toContain("values ('rental-photos', 'rental-photos', false, 5242880,");
    expect(sql).toContain("array['image/jpeg', 'image/png', 'image/webp']");
  });

  it.each(["rental_units", "rental_tenants"])("adds photo columns to %s", (table) => {
    expect(sql).toContain(`alter table ${table} add column if not exists photo_bucket text`);
    expect(sql).toContain(`alter table ${table} add column if not exists photo_object_path text`);
  });

  it("scopes photo storage access to the authenticated owner's own folder", () => {
    expect(sql).toContain("(storage.foldername(name))[1]=auth.uid()::text");
    for (const action of ["select", "insert", "delete"]) {
      expect(sql).toContain(`create policy "rental_photo_objects_owner_${action}" on storage.objects for ${action} to authenticated`);
    }
  });

  it("does not grant tenant lease-access to the photo bucket", () => {
    expect(sql).not.toContain("rental_actor_has_lease_access");
    expect(sql).not.toMatch(/tenant_select/);
  });
});
