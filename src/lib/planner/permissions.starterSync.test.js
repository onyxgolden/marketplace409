// Planner starter-role sync guard (planning-process slice).
//
// The JS catalog in permissions.js is UI affordance only — the SQL
// starter literal in the migration is what actually provisions roles.
// This test pins the two together set-for-set so a future capability
// added in one place and forgotten in the other fails loudly instead
// of silently misleading the admin UI (or silently not provisioning).
// The migration under test is 20261112000000 (the planning-process
// slice), whose v_starter replaces the 20261110000000 literal wholesale.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLANNER_CAPABILITIES, STARTER_ROLE_CAPABILITIES } from "./permissions.js";

describe("planner starter sets: JS catalog vs migration literal", () => {
  it("matches the 20261112000000 v_starter JSON exactly, set for set", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/20261112000000_forge_work_planning_process_steps.sql"),
      "utf8",
    );
    const m = sql.match(/v_starter jsonb := '(\[.*?\])'::jsonb/s);
    expect(m, "v_starter literal not found in the migration").not.toBeNull();
    const starter = JSON.parse(m[1]);
    expect(starter.map((r) => r.role_key).sort()).toEqual(Object.keys(STARTER_ROLE_CAPABILITIES).sort());
    for (const def of starter) {
      expect([...STARTER_ROLE_CAPABILITIES[def.role_key]].sort()).toEqual([...def.capabilities].sort());
    }
    for (const def of starter) {
      for (const cap of def.capabilities) {
        expect(PLANNER_CAPABILITIES.some((c) => c.key === cap)).toBe(true);
      }
    }
  });

  it("grants the three planning-process capabilities exactly as the brief's role table states", () => {
    const has = (role, cap) => STARTER_ROLE_CAPABILITIES[role].includes(cap);
    // Planner Admin: all three. Planner: read + update. Scheduler: read.
    // Reviewer: read + review. Read-only: read.
    expect(has("planner_admin", "planner.planning_steps.read")).toBe(true);
    expect(has("planner_admin", "planner.planning_steps.update")).toBe(true);
    expect(has("planner_admin", "planner.planning_steps.review")).toBe(true);
    expect(has("planner", "planner.planning_steps.read")).toBe(true);
    expect(has("planner", "planner.planning_steps.update")).toBe(true);
    expect(has("planner", "planner.planning_steps.review")).toBe(false);
    expect(has("scheduler", "planner.planning_steps.read")).toBe(true);
    expect(has("scheduler", "planner.planning_steps.update")).toBe(false);
    expect(has("scheduler", "planner.planning_steps.review")).toBe(false);
    expect(has("reviewer", "planner.planning_steps.read")).toBe(true);
    expect(has("reviewer", "planner.planning_steps.update")).toBe(false);
    expect(has("reviewer", "planner.planning_steps.review")).toBe(true);
    expect(has("read_only", "planner.planning_steps.read")).toBe(true);
    expect(has("read_only", "planner.planning_steps.update")).toBe(false);
    expect(has("read_only", "planner.planning_steps.review")).toBe(false);
  });
});
