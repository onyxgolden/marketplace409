import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260827000000_create_scheduling_relational_schema.sql"), "utf8").toLowerCase().replace(/\s+/g, " ");

const OWNER_SCOPED_TABLES = [
  "schedule_calendars", "schedule_calendar_holidays", "schedule_projects", "schedule_wbs_nodes",
  "schedule_blackout_windows", "schedule_lanes", "schedule_blocks", "schedule_dependencies",
  "schedule_hammock_anchors",
];

describe("scheduling relational schema migration", () => {
  it("creates every reconciled table", () => {
    for (const table of OWNER_SCOPED_TABLES) {
      expect(sql).toContain(`create table if not exists ${table}`);
    }
  });

  it("drops the schedule_templates table entirely (Decision 4 -- templates stay client-side)", () => {
    expect(sql).not.toContain("create table if not exists schedule_templates");
    expect(sql).not.toContain('create policy "schedule_templates_read_all"');
  });

  it("gives every owner-scoped table a composite (owner_id, id) primary key and force RLS with an owner-scoped policy", () => {
    for (const table of OWNER_SCOPED_TABLES) {
      const tableStart = sql.indexOf(`create table if not exists ${table}`);
      const tableEnd = sql.indexOf(";", tableStart);
      const tableSql = sql.slice(tableStart, tableEnd);
      expect(tableSql).toContain("owner_id text not null");
      expect(tableSql).toContain("primary key (owner_id, id)");

      expect(sql).toContain(`alter table ${table} enable row level security`);
      expect(sql).toContain(`alter table ${table} force row level security`);
      expect(sql).toContain(`create policy "${table}_owner_all" on ${table} for all to authenticated using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text)`);
    }
  });

  it("resolves the schedule_calendars <-> schedule_projects circular reference via ALTER TABLE, not an inline FK", () => {
    const calendarsTableStart = sql.indexOf("create table if not exists schedule_calendars");
    const calendarsTableEnd = sql.indexOf(";", calendarsTableStart);
    expect(sql.slice(calendarsTableStart, calendarsTableEnd)).not.toContain("references schedule_projects");
    expect(sql).toContain("alter table schedule_calendars add constraint schedule_calendars_project_fkey foreign key (owner_id, schedule_project_id) references schedule_projects(owner_id, id) on delete cascade");
  });

  it("gives schedule_projects an is_public column and a public-select policy, mirroring forge_scheduling_projects", () => {
    expect(sql).toContain("is_public boolean not null default false");
    expect(sql).toContain('create policy "schedule_projects_public_select" on schedule_projects for select to authenticated using (is_public = true)');
  });

  it("does not constrain project_type/template_id to an enum (Decision 4 -- free text, no CHECK)", () => {
    const projectsStart = sql.indexOf("create table if not exists schedule_projects");
    const projectsEnd = sql.indexOf(";", projectsStart);
    const projectsSql = sql.slice(projectsStart, projectsEnd);
    expect(projectsSql).toContain("project_type text,");
    expect(projectsSql).toContain("template_id text,");
    expect(projectsSql).not.toContain("project_type text not null check");
  });

  it("unifies Gantt blocks and WBS activities in schedule_blocks (Decision 1): lane_id and wbs_node_id are both nullable, and at least one must be set", () => {
    const blocksStart = sql.indexOf("create table if not exists schedule_blocks");
    const blocksEnd = sql.indexOf(";", blocksStart);
    const blocksSql = sql.slice(blocksStart, blocksEnd);
    expect(blocksSql).toContain("lane_id text,");
    expect(blocksSql).toContain("wbs_node_id text,");
    expect(blocksSql).not.toContain("lane_id text not null");
    expect(blocksSql).toContain("check (lane_id is not null or wbs_node_id is not null)");
    expect(blocksSql).toContain("foreign key (owner_id, wbs_node_id) references schedule_wbs_nodes(owner_id, id) on delete cascade");
  });

  it("adds percent_complete and text-styling columns to schedule_blocks (Decision 5 -- persisted user data, not UI-only)", () => {
    const blocksStart = sql.indexOf("create table if not exists schedule_blocks");
    const blocksEnd = sql.indexOf(";", blocksStart);
    const blocksSql = sql.slice(blocksStart, blocksEnd);
    expect(blocksSql).toContain("percent_complete smallint not null default 0 check (percent_complete between 0 and 100)");
    expect(blocksSql).toContain("font_size numeric,");
    expect(blocksSql).toContain("text_color text,");
    expect(blocksSql).toContain("bold boolean not null default true");
  });

  it("leaves the CPM-computed columns nullable/false -- no engine exists yet to populate them", () => {
    const blocksStart = sql.indexOf("create table if not exists schedule_blocks");
    const blocksEnd = sql.indexOf(";", blocksStart);
    const blocksSql = sql.slice(blocksStart, blocksEnd);
    expect(blocksSql).toContain("early_start date, early_finish date, late_start date, late_finish date");
    expect(blocksSql).toContain("total_float_days int,");
    expect(blocksSql).toContain("is_critical boolean not null default false");
  });

  it("supports the full P6 constraint-type taxonomy and all 10 anticipated values", () => {
    expect(sql).toContain("constraint_type text check (constraint_type in ('asap', 'alap', 'start_on', 'finish_on', 'snet', 'snlt', 'fnet', 'fnlt', 'must_start_on', 'must_finish_on'))");
  });

  it("supports all 4 P6 relationship types with signed lag on schedule_dependencies, matching the live app's shape 1:1", () => {
    expect(sql).toContain("relationship_type text not null check (relationship_type in ('fs', 'ss', 'ff', 'sf'))");
    expect(sql).toContain("lag_days int not null default 0");
    expect(sql).toContain("check (predecessor_id <> successor_id)");
  });

  it("adds a new schedule_wbs_nodes table for the WBS hierarchy (absent from the abandoned draft, which predates the WBS feature)", () => {
    const nodesStart = sql.indexOf("create table if not exists schedule_wbs_nodes");
    const nodesEnd = sql.indexOf(";", nodesStart);
    const nodesSql = sql.slice(nodesStart, nodesEnd);
    expect(nodesSql).toContain("parent_id text,");
    expect(nodesSql).toContain("foreign key (owner_id, parent_id) references schedule_wbs_nodes(owner_id, id) on delete cascade");
    expect(nodesSql).toContain("check (parent_id <> id)");
    // MAX_WBS_DEPTH is enforced app-side (wbsState.js already walks the ancestor chain), not by a
    // DB check -- a depth constraint can't easily be expressed without a recursive trigger, and
    // matching the app's existing enforcement is the accurate reconciliation.
    expect(nodesSql).not.toContain("depth");
  });

  it("adds a new schedule_blackout_windows table, kept separate from schedule_calendar_holidays (Decision 3)", () => {
    const windowsStart = sql.indexOf("create table if not exists schedule_blackout_windows");
    const windowsEnd = sql.indexOf(";", windowsStart);
    const windowsSql = sql.slice(windowsStart, windowsEnd);
    expect(windowsSql).toContain("schedule_project_id text not null");
    expect(windowsSql).toContain("start_date date not null, end_date date not null");
    expect(windowsSql).toContain("check (end_date >= start_date)");
  });

  it("makes schedule_lanes.color nullable (live lanes have no color field -- fabricating one would be inventing data)", () => {
    const lanesStart = sql.indexOf("create table if not exists schedule_lanes");
    const lanesEnd = sql.indexOf(";", lanesStart);
    const lanesSql = sql.slice(lanesStart, lanesEnd);
    expect(lanesSql).toContain("color text check (color ~ '^#[0-9a-fa-f]{6}$')");
    expect(lanesSql).not.toContain("color text not null");
  });

  it("defaults schedule_calendars.working_days to an array of weekday ints, matching the live app's shape, not the abandoned draft's object shape", () => {
    expect(sql).toContain("working_days jsonb not null default '[1,2,3,4,5]'::jsonb");
  });

  it("keeps schedule_hammock_anchors unchanged from the abandoned draft, unused until a later phase", () => {
    const anchorsStart = sql.indexOf("create table if not exists schedule_hammock_anchors");
    const anchorsEnd = sql.indexOf(";", anchorsStart);
    const anchorsSql = sql.slice(anchorsStart, anchorsEnd);
    expect(anchorsSql).toContain("anchor_role text not null check (anchor_role in ('start', 'finish', 'both'))");
    expect(anchorsSql).toContain("check (hammock_block_id <> anchor_block_id)");
  });

  it("never deletes any existing table or data", () => {
    expect(sql).not.toContain("drop table");
    expect(sql).not.toContain("delete from");
  });
});
