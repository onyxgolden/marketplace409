import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("supabase/migrations/20260817000100_create_scheduling_engine.sql", "utf8");
const seed = readFileSync("supabase/migrations/20260817000200_seed_scheduling_templates.sql", "utf8");

const OWNER_SCOPED_TABLES = [
  "schedule_calendars", "schedule_calendar_holidays", "schedule_projects",
  "schedule_lanes", "schedule_blocks", "schedule_dependencies", "schedule_hammock_anchors",
];

describe("scheduling engine schema", () => {
  it("creates every table from the data model", () => {
    for (const table of [...OWNER_SCOPED_TABLES, "schedule_templates"]) {
      expect(schema).toContain(`create table if not exists ${table}`);
    }
  });

  it("scopes every owner table with a composite (owner_id, id) primary key", () => {
    for (const table of OWNER_SCOPED_TABLES) {
      const tableStart = schema.indexOf(`create table if not exists ${table}`);
      const tableEnd = schema.indexOf(");", tableStart);
      const body = schema.slice(tableStart, tableEnd);
      expect(body).toContain("owner_id text not null");
      expect(body).toContain("primary key (owner_id, id)");
    }
  });

  it("forces row-level security and adds an owner-scoped policy on every owner table", () => {
    for (const table of OWNER_SCOPED_TABLES) {
      expect(schema).toContain(`alter table ${table} enable row level security;`);
      expect(schema).toContain(`alter table ${table} force row level security;`);
      expect(schema).toMatch(new RegExp(`create policy "${table}_owner_all" on ${table} for all to authenticated\\nusing \\(owner_id = auth\\.uid\\(\\)::text\\) with check \\(owner_id = auth\\.uid\\(\\)::text\\);`));
    }
  });

  it("keeps schedule_templates as read-only reference data, not owner-scoped", () => {
    expect(schema).not.toContain("schedule_templates_owner_all");
    expect(schema).toContain("create policy \"schedule_templates_read_all\" on schedule_templates for select to authenticated using (true);");
  });

  it("resolves the schedule_projects <-> schedule_calendars cycle via ALTER TABLE", () => {
    expect(schema).toContain("foreign key (owner_id, default_calendar_id) references schedule_calendars(owner_id, id) on delete set null");
    expect(schema).toContain("add constraint schedule_calendars_project_fkey");
  });

  it("constrains block_type, relationship_type, and anchor_role to the spec'd enums", () => {
    expect(schema).toContain("check (block_type in ('task', 'milestone', 'hammock'))");
    expect(schema).toContain("check (relationship_type in ('FS', 'SS', 'FF', 'SF'))");
    expect(schema).toContain("check (anchor_role in ('start', 'finish', 'both'))");
  });

  it("keeps milestone blocks at zero duration and pairs constraint type with a date", () => {
    expect(schema).toContain("check (block_type <> 'milestone' or duration_days = 0)");
    expect(schema).toContain("check ((constraint_type is null) = (constraint_date is null))");
  });

  it("prevents a dependency or hammock anchor from referencing itself", () => {
    expect(schema).toContain("check (predecessor_id <> successor_id)");
    expect(schema).toContain("check (hammock_block_id <> anchor_block_id)");
  });
});

describe("scheduling starter templates seed", () => {
  it("seeds all four project types", () => {
    for (const projectType of ["capital_industrial", "commercial_construction", "residential_construction", "custom"]) {
      expect(seed).toContain(`'${projectType}',`);
    }
  });

  it("is idempotent on re-run", () => {
    const upserts = seed.match(/on conflict \(id\) do update set name = excluded\.name, template = excluded\.template;/g) || [];
    expect(upserts.length).toBe(4);
  });

  it("gives the custom template an empty starter set", () => {
    expect(seed).toContain('\'{"lanes": [], "chips": []}\'::jsonb');
  });

  it("fully ports the capital/industrial chip set from the prototype", () => {
    expect(seed).toContain("Long-Lead Equipment Fabrication");
    expect(seed).toContain("Pre-Startup Safety Review (PSSR)");
  });
});
