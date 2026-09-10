import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260910000100_enforce_reservation_inventory_actor_attribution.sql"),
  "utf8",
);

describe("reservation inventory actor-attribution migration", () => {
  it("forces created_by/updated_by from auth.uid() on the two directly RLS-writable tables, never trusting a client-supplied value", () => {
    expect(sql).toContain("new.created_by := auth.uid()");
    expect(sql).toContain("new.updated_by := auth.uid()");
    expect(sql).toContain("before insert or update on reservation_inventory_settings");
    expect(sql).toContain("before insert or update on reservation_rate_plans");
  });

  it("keeps created_by immutable after insert instead of re-deriving it on update", () => {
    expect(sql).toContain("new.created_by := old.created_by");
  });
});
