import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260810000100_create_property_hvac_system_replacements.sql"), "utf8").toLowerCase().replace(/\s+/g, " ");

describe("HVAC system replacement migration", () => {
  it("creates an append-only owner-scoped transition", () => {
    expect(migration).toContain("create table if not exists property_hvac_system_replacements");
    expect(migration).toContain("primary key (owner_id, id)");
    expect(migration).not.toContain("property_hvac_replacements_owner_update");
    expect(migration).not.toContain("property_hvac_replacements_owner_delete");
  });

  it("requires distinct one-to-one predecessor and replacement systems", () => {
    expect(migration).toContain("predecessor_system_id <> replacement_system_id");
    expect(migration).toContain("property_hvac_replacement_predecessor_unique");
    expect(migration).toContain("property_hvac_replacement_successor_unique");
  });

  it("keeps both systems within the same owner and property", () => {
    expect(migration).toContain("foreign key (owner_id, property_id, predecessor_system_id) references property_hvac_systems (owner_id, property_id, id)");
    expect(migration).toContain("foreign key (owner_id, property_id, replacement_system_id) references property_hvac_systems (owner_id, property_id, id)");
  });

  it("binds each lifecycle event to its correct system", () => {
    expect(migration).toContain("foreign key (owner_id, predecessor_system_id, failure_event_id) references property_hvac_component_events (owner_id, system_id, id)");
    expect(migration).toContain("foreign key (owner_id, replacement_system_id, installation_event_id) references property_hvac_component_events (owner_id, system_id, id)");
  });

  it("links owner and property scoped evidence", () => {
    expect(migration).toContain("foreign key (owner_id, property_id, evidence_id) references property_evidence (owner_id, property_id, id)");
    expect(migration).toContain("idx_property_hvac_replacements_owner_evidence");
  });

  it("prevents deletion from erasing lifecycle history", () => {
    expect(migration.match(/on delete restrict/g)).toHaveLength(5);
    expect(migration).not.toContain("on delete cascade");
  });

  it("forces authenticated owner RLS", () => {
    expect(migration).toContain("alter table property_hvac_system_replacements force row level security");
    expect(migration).toContain("property_hvac_replacements_owner_select");
    expect(migration).toContain("property_hvac_replacements_owner_insert");
    expect(migration).toContain("owner_id = auth.uid()::text");
  });

  it("indexes property and lifecycle lookups", () => {
    expect(migration).toContain("idx_property_hvac_replacements_owner_property");
    expect(migration).toContain("idx_property_hvac_replacements_owner_predecessor");
    expect(migration).toContain("idx_property_hvac_replacements_owner_successor");
  });
});
