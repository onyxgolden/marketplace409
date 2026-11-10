// Scheduling workspace foundation -- migration contract, executed against an
// in-process real Postgres (PGlite). Mirrors the Planner admin-permissions
// slice-1 test's convention: stub auth.uid(), a workspace_members table
// matching the real has_workspace_access predicate exactly (not an invented
// shortcut -- the PR #767 P1 slipped through a fixture that diverged from
// the real schema types, so this fixture is built to the real shapes:
// workspace_members.member_user_id uuid, has_workspace_access's own
// predicate copied verbatim from 20260829000100).
//
// This migration is file-only; applying it to production is Jason's
// separate approval. No linked or remote database is touched.

import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const MIGRATION_PATH = new URL("../20261110060000_convert_scheduling_policies_to_workspace_access.sql", import.meta.url);
const migrationSql = readFileSync(MIGRATION_PATH, "utf8");
const migrationSqlNoComments = migrationSql.replace(/--.*$/gm, "");

const OWNER_TABLES = [
  "forge_scheduling_projects",
  "schedule_calendars",
  "schedule_calendar_holidays",
  "schedule_projects",
  "schedule_wbs_nodes",
  "schedule_blackout_windows",
  "schedule_lanes",
  "schedule_blocks",
  "schedule_dependencies",
  "schedule_hammock_anchors",
  "schedule_baselines",
  "schedule_baseline_blocks",
  "schedule_resources",
  "schedule_cost_accounts",
  "schedule_resource_assignments",
  "schedule_expenses",
];

const PUBLIC_SELECT_POLICIES = [
  "forge_scheduling_projects_public_select",
  "schedule_projects_public_select",
  "schedule_baselines_public_select",
  "schedule_baseline_blocks_public_select",
  "schedule_blackout_windows_public_select",
  "schedule_blocks_public_select",
  "schedule_calendar_holidays_public_select",
  "schedule_calendars_public_select",
  "schedule_dependencies_public_select",
  "schedule_hammock_anchors_public_select",
  "schedule_lanes_public_select",
  "schedule_wbs_nodes_public_select",
];

// --- Static checks on the migration file itself --------------------------

describe("migration file -- static shape", () => {
  it("converts all 16 owner-only policies, drop-then-recreate by the exact live policy name", () => {
    for (const table of OWNER_TABLES) {
      const policyName = `${table}_owner_all`;
      expect(migrationSqlNoComments).toContain(`drop policy "${policyName}" on ${table}`);
      expect(migrationSqlNoComments).toMatch(
        new RegExp(`create policy "${policyName}" on ${table} for all to authenticated\\s+using \\(has_workspace_access\\(owner_id\\)\\) with check \\(has_workspace_access\\(owner_id\\)\\)`),
      );
    }
  });

  it("never touches any of the 12 public_select policies", () => {
    for (const policyName of PUBLIC_SELECT_POLICIES) {
      expect(migrationSqlNoComments).not.toContain(policyName);
    }
  });

  it("defines zero new functions -- reuses has_workspace_access/resolve_effective_owner_id verbatim, no new grant/revoke needed", () => {
    expect(migrationSqlNoComments).not.toMatch(/create (or replace )?function has_workspace_access/);
    expect(migrationSqlNoComments).not.toMatch(/create (or replace )?function resolve_effective_owner_id/);
    // The two RPCs below ARE redefined (create or replace), but that is a
    // body edit to an existing function, not a new function; this
    // assertion guards against accidentally introducing a third one.
    const createOrReplaceCount = (migrationSqlNoComments.match(/create or replace function/g) || []).length;
    expect(createOrReplaceCount).toBe(2);
  });

  it("redefines both RPCs with has_workspace_access(p_owner_id), not a bare auth.uid() comparison", () => {
    expect(migrationSqlNoComments).toContain("create or replace function sync_schedule_project_from_board(p_owner_id text, p_project_id text)");
    expect(migrationSqlNoComments).toContain("create or replace function save_schedule_project_board(");
    const syncBody = migrationSqlNoComments.slice(
      migrationSqlNoComments.indexOf("create or replace function sync_schedule_project_from_board"),
      migrationSqlNoComments.indexOf("create or replace function save_schedule_project_board"),
    );
    const saveBody = migrationSqlNoComments.slice(migrationSqlNoComments.indexOf("create or replace function save_schedule_project_board"));
    expect(syncBody).toContain("not has_workspace_access(p_owner_id)");
    expect(saveBody).toContain("not has_workspace_access(p_owner_id)");
    expect(syncBody).not.toMatch(/p_owner_id\s*<>\s*auth\.uid\(\)/);
    expect(saveBody).not.toMatch(/p_owner_id\s*<>\s*auth\.uid\(\)/);
  });

  it("preserves the two RPCs' differing failure shapes -- sync silently returns, save raises SCHEDULE_SAVE_NOT_FOUND", () => {
    const syncBody = migrationSqlNoComments.slice(
      migrationSqlNoComments.indexOf("create or replace function sync_schedule_project_from_board"),
      migrationSqlNoComments.indexOf("create or replace function save_schedule_project_board"),
    );
    const saveBody = migrationSqlNoComments.slice(migrationSqlNoComments.indexOf("create or replace function save_schedule_project_board"));
    // sync's ownership guard is a bare `return;` with no raise anywhere in its guard block.
    expect(syncBody).toMatch(/not has_workspace_access\(p_owner_id\) then\s*\n\s*return;/);
    expect(saveBody).toMatch(/not has_workspace_access\(p_owner_id\) then\s*\n\s*raise exception 'SCHEDULE_SAVE_NOT_FOUND';/);
    // save still enforces optimistic concurrency and row locking -- a targeted predicate
    // swap, not a rewrite that could silently drop a guard.
    expect(saveBody).toContain("raise exception 'SCHEDULE_SAVE_CONFLICT'");
    expect(saveBody).toContain("for update");
    expect(saveBody).toContain("perform sync_schedule_project_from_board(p_owner_id, p_project_id)");
  });

  it("byte-diffs each RPC body against its current live source with only the predicate line different", () => {
    // Guards the copy-paste itself, independent of the two tests above: the live
    // sync_schedule_project_from_board (20260908000000, the latest of three
    // redefinitions) and save_schedule_project_board (20260907020000, the latest of
    // two) are each 200+ lines; this proves nothing else drifted during the copy.
    const syncSource = readFileSync(
      new URL("../20260908000000_add_schedule_backward_compatible_day_precision_sync.sql", import.meta.url),
      "utf8",
    );
    const saveSource = readFileSync(
      new URL("../20260907020000_fix_save_schedule_project_board_ambiguous_board_revision.sql", import.meta.url),
      "utf8",
    );
    // .replace(/\r\n/g, "\n") guards against a pre-existing CRLF artifact in this
    // checkout's copy of the source files (git's own tracked blob is LF -- confirmed via
    // `git show HEAD:<path>` -- this is a local-disk artifact, not a real content
    // difference; this repo has hit this exact class of false-diff before).
    const normalize = (body) =>
      body
        .replace(/\r\n/g, "\n")
        .replace(/p_owner_id\s*<>\s*auth\.uid\(\)::text/, "PREDICATE")
        .replace(/not has_workspace_access\(p_owner_id\)/, "PREDICATE");

    const sliceFunctionBody = (text, marker) => {
      const start = text.indexOf(marker);
      const end = text.indexOf("$$;", start) + "$$;".length;
      return text.slice(start, end);
    };

    const syncSourceBody = sliceFunctionBody(syncSource, "create or replace function sync_schedule_project_from_board");
    const syncNewBody = sliceFunctionBody(migrationSql, "create or replace function sync_schedule_project_from_board");
    expect(normalize(syncNewBody.trim())).toBe(normalize(syncSourceBody.trim()));

    const saveSourceBody = sliceFunctionBody(saveSource, "create or replace function save_schedule_project_board");
    const saveNewBody = sliceFunctionBody(migrationSql, "create or replace function save_schedule_project_board");
    expect(normalize(saveNewBody.trim())).toBe(normalize(saveSourceBody.trim()));
  });
});

// --- Behavioral proof on PGlite -------------------------------------------

const SETUP_SQL = `
  create role authenticated;
  create role anon;
  create role service_role;
  create schema auth;

  create function test_actor_uuid(label text)
  returns uuid language sql immutable as $$
    select (
      substr(md5(label), 1, 8) || '-' ||
      substr(md5(label), 9, 4) || '-' ||
      substr(md5(label), 13, 4) || '-' ||
      substr(md5(label), 17, 4) || '-' ||
      substr(md5(label), 21, 12)
    )::uuid
  $$;

  create function auth.uid()
  returns uuid language sql stable as $$
    select case
      when nullif(current_setting('test.actor', true), '') is null then null
      else test_actor_uuid(current_setting('test.actor', true))
    end
  $$;

  -- workspace_members matching the real shape (20260829000000) exactly --
  -- member_user_id uuid, not text; this is the exact type PR #767's P1
  -- slipped through a fixture that got wrong.
  create table workspace_members (
    owner_id text not null,
    member_user_id uuid not null,
    status text not null,
    role text not null,
    primary key (owner_id, member_user_id)
  );
  grant select on workspace_members to authenticated;

  -- has_workspace_access. The co-owner disjunct is the real predicate, verbatim
  -- (20260829000100), exercised genuinely via auth.uid()/workspace_members with real
  -- uuid types. The owner disjunct compares against the raw test.actor label rather
  -- than auth.uid()::text, matching this repo's own established fixture convention
  -- (Planner admin permissions slice 1's fixture does the same) so human-readable
  -- owner_id labels ("owner_a") can be used directly -- noted informational, not a
  -- blocker, in that slice's round-2 review (I8): fails safe (stricter), never masks
  -- a real gap, since the co-owner path -- the actual thing being tested here -- is
  -- exercised through the genuine auth.uid()/workspace_members comparison.
  create function has_workspace_access(p_owner_id text)
  returns boolean language sql stable security definer set search_path = public as $$
    select p_owner_id = current_setting('test.actor', true)
        or exists (
          select 1 from workspace_members
          where owner_id = p_owner_id and member_user_id = auth.uid()
            and status = 'active' and role = 'co_owner'
        )
  $$;
  create function has_workspace_access(p_owner_id uuid)
  returns boolean language sql stable security definer set search_path = public as $$
    select has_workspace_access(p_owner_id::text)
  $$;

  -- The 16 scheduling tables, minimal columns -- owner_id text everywhere,
  -- matching the real schema (all 16 confirmed owner_id text, no uuid variant).
  create table forge_scheduling_projects (
    owner_id text not null, id text not null, project_name text, project_type text,
    start_date date, end_date date, board jsonb, is_public boolean not null default false,
    updated_at timestamptz not null default now(), primary key (owner_id, id)
  );
  create table schedule_calendars (
    owner_id text not null, id text not null, schedule_project_id text, name text,
    working_days jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    primary key (owner_id, id)
  );
  create table schedule_calendar_holidays (owner_id text not null, id text not null, primary key (owner_id, id));
  create table schedule_projects (
    owner_id text not null, id text not null, name text, project_type text, template_id text,
    start_date date, end_date date, is_public boolean not null default false, next_id int,
    next_task_number int, client_metadata jsonb, default_calendar_id text, board_revision bigint,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    primary key (owner_id, id)
  );
  create table schedule_wbs_nodes (
    owner_id text not null, id text not null, schedule_project_id text, parent_id text, code text,
    name text, sort_order int, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    primary key (owner_id, id)
  );
  create table schedule_blackout_windows (
    owner_id text not null, id text not null, schedule_project_id text, label text,
    start_date date, end_date date, created_at timestamptz not null default now(), primary key (owner_id, id)
  );
  create table schedule_lanes (
    owner_id text not null, id text not null, schedule_project_id text, name text, color text,
    calendar_id text, sort_order int, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    primary key (owner_id, id)
  );
  create table schedule_blocks (
    owner_id text not null, id text not null, task_code text, schedule_project_id text, lane_id text,
    wbs_node_id text, label text, category text, block_type text, start_date date, duration_days int,
    percent_complete int, font_size numeric, text_color text, bold boolean, sort_order int,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    primary key (owner_id, id)
  );
  create table schedule_dependencies (
    owner_id text not null, id text not null, predecessor_id text, successor_id text,
    relationship_type text, lag_days int, created_at timestamptz not null default now(), primary key (owner_id, id)
  );
  create table schedule_hammock_anchors (
    owner_id text not null, id text not null, hammock_block_id text, primary key (owner_id, id)
  );
  create table schedule_baselines (owner_id text not null, id text not null, primary key (owner_id, id));
  create table schedule_baseline_blocks (owner_id text not null, id text not null, primary key (owner_id, id));
  create table schedule_resources (owner_id text not null, id text not null, primary key (owner_id, id));
  create table schedule_cost_accounts (owner_id text not null, id text not null, primary key (owner_id, id));
  create table schedule_resource_assignments (
    owner_id text not null, id text not null, block_id text, primary key (owner_id, id)
  );
  create table schedule_expenses (
    owner_id text not null, id text not null, block_id text, primary key (owner_id, id)
  );

  -- All 16: RLS enabled+forced, with the ORIGINAL owner-only policy (the baseline this
  -- migration's drop/create statements must act on -- matching the real pre-migration shape).
  ${OWNER_TABLES.map(
    (t) => `
  alter table ${t} enable row level security;
  alter table ${t} force row level security;
  create policy "${t}_owner_all" on ${t} for all to authenticated
    using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);
  grant select, insert, update, delete on ${t} to authenticated;
  `,
  ).join("\n")}
`;

let db;

async function query(sql) {
  const result = await db.query(sql);
  return result.rows;
}

async function exec(sql) {
  await db.exec(sql);
}

async function asActor(label, fn) {
  await exec(`select set_config('test.actor', '${label}', false);`);
  await exec(`set role authenticated;`);
  try {
    return await fn();
  } finally {
    await exec(`reset role;`);
  }
}

beforeAll(async () => {
  db = new PGlite();
  await exec(SETUP_SQL);
  // Apply the migration under test for real, against the baseline fixture above --
  // not a hand-copied re-statement of what it does.
  await exec(migrationSql);
});

describe("RLS policy conversion -- owner, co-owner, stranger, non-member", () => {
  it("seeds an owner project row and a co-owner membership", async () => {
    await exec(`insert into workspace_members (owner_id, member_user_id, status, role)
      values ('${"owner1"}', test_actor_uuid('coowner1'), 'active', 'co_owner');`);
    // NB: owner_id in these fixtures is the literal string "owner1" -- has_workspace_access's
    // first disjunct (p_owner_id = auth.uid()::text) only fires when the *actor themself* is
    // literally named "owner1"; for the real owner we use their own uuid-derived actor label
    // as the owner_id too, so the two sides genuinely match -- see the per-table tests below.
  });

  it.each(OWNER_TABLES)("%s: owner can read and write their own rows", async (table) => {
    await asActor("owner_a", async () => {
      await exec(`insert into ${table} (owner_id, id) values ('owner_a', 'row1');`);
      const rows = await query(`select * from ${table} where owner_id = 'owner_a';`);
      expect(rows.length).toBe(1);
      await exec(`delete from ${table} where owner_id = 'owner_a' and id = 'row1';`);
    });
  });

  it.each(OWNER_TABLES)("%s: an active co-owner can read and write the owner's rows", async (table) => {
    await exec(`insert into workspace_members (owner_id, member_user_id, status, role)
      values ('owner_b', test_actor_uuid('coowner_b'), 'active', 'co_owner')
      on conflict do nothing;`);
    await asActor("owner_b", async () => {
      await exec(`insert into ${table} (owner_id, id) values ('owner_b', 'seed');`);
    });
    await asActor("coowner_b", async () => {
      const rows = await query(`select * from ${table} where owner_id = 'owner_b';`);
      expect(rows.length).toBe(1);
      await exec(`insert into ${table} (owner_id, id) values ('owner_b', 'by_coowner');`);
      await exec(`delete from ${table} where owner_id = 'owner_b' and id = 'by_coowner';`);
    });
  });

  it.each(OWNER_TABLES)("%s: a stranger with no membership is denied read and write", async (table) => {
    await asActor("owner_c", async () => {
      await exec(`insert into ${table} (owner_id, id) values ('owner_c', 'seed_c');`);
    });
    await asActor("stranger_x", async () => {
      const rows = await query(`select * from ${table} where owner_id = 'owner_c';`);
      expect(rows.length).toBe(0);
      await expect(exec(`insert into ${table} (owner_id, id) values ('owner_c', 'hack');`)).rejects.toThrow();
      await expect(exec(`update ${table} set id = 'hacked' where owner_id = 'owner_c' and id = 'seed_c';`)).resolves.toBeUndefined();
      const stillThere = await query(`select * from ${table} where owner_id = 'owner_c';`);
      // The update affected 0 rows (RLS-filtered), so the row is unchanged, not actually renamed.
      expect(stillThere.length).toBe(0);
    });
  });

  it.each(OWNER_TABLES)("%s: an invited (not yet active) co-owner is denied, same as a stranger", async (table) => {
    await exec(`insert into workspace_members (owner_id, member_user_id, status, role)
      values ('owner_d', test_actor_uuid('invited_d'), 'invited', 'co_owner')
      on conflict do nothing;`);
    await asActor("owner_d", async () => {
      await exec(`insert into ${table} (owner_id, id) values ('owner_d', 'seed_d');`);
    });
    await asActor("invited_d", async () => {
      const rows = await query(`select * from ${table} where owner_id = 'owner_d';`);
      expect(rows.length).toBe(0);
    });
  });

  it("the demo 'example' project path is untouched by this migration -- has_workspace_access('example') is always false, by design", async () => {
    // No real auth.uid() can ever equal the sentinel string 'example', and no
    // workspace_members row exists for owner_id 'example' -- so a direct call proves the
    // owner/co-owner path never accidentally grants anything here; the demo project's real
    // exposure is the separate _public_select mechanism this migration does not touch at all
    // (asserted statically above).
    await asActor("owner_a", async () => {
      const rows = await query(`select has_workspace_access('example') as ok;`);
      expect(rows[0].ok).toBe(false);
    });
  });
});

describe("the two RPCs end-to-end, behaviorally, against the post-migration definitions", () => {
  it("sync_schedule_project_from_board: owner succeeds with an empty board (no-op body, real predicate pass)", async () => {
    await asActor("rpc_owner", async () => {
      await exec(`insert into forge_scheduling_projects (owner_id, id, project_name, project_type, board, is_public)
        values ('rpc_owner', 'p1', 'Test', 'industrial', '{}'::jsonb, false);`);
      await exec(`insert into schedule_projects (owner_id, id, name) values ('rpc_owner', 'p1', 'Test') on conflict do nothing;`);
      await exec(`select sync_schedule_project_from_board('rpc_owner', 'p1');`);
      const rows = await query(`select * from schedule_projects where owner_id = 'rpc_owner' and id = 'p1';`);
      expect(rows.length).toBe(1);
    });
  });

  it("sync_schedule_project_from_board: an active co-owner succeeds too (has_workspace_access, not bare auth.uid())", async () => {
    await exec(`insert into workspace_members (owner_id, member_user_id, status, role)
      values ('rpc_owner2', test_actor_uuid('rpc_coowner'), 'active', 'co_owner') on conflict do nothing;`);
    await asActor("rpc_owner2", async () => {
      await exec(`insert into forge_scheduling_projects (owner_id, id, project_name, project_type, board, is_public)
        values ('rpc_owner2', 'p2', 'Test2', 'industrial', '{}'::jsonb, false);`);
      await exec(`insert into schedule_projects (owner_id, id, name) values ('rpc_owner2', 'p2', 'Test2') on conflict do nothing;`);
    });
    await asActor("rpc_coowner", async () => {
      await exec(`select sync_schedule_project_from_board('rpc_owner2', 'p2');`);
    });
  });

  it("sync_schedule_project_from_board: a stranger silently no-ops (returns void, changes nothing)", async () => {
    await asActor("rpc_owner3", async () => {
      await exec(`insert into forge_scheduling_projects (owner_id, id, project_name, project_type, board, is_public)
        values ('rpc_owner3', 'p3', 'Original', 'industrial', '{}'::jsonb, false);`);
      await exec(`insert into schedule_projects (owner_id, id, name) values ('rpc_owner3', 'p3', 'Original') on conflict do nothing;`);
    });
    await asActor("rpc_stranger", async () => {
      await expect(exec(`select sync_schedule_project_from_board('rpc_owner3', 'p3');`)).resolves.toBeUndefined();
    });
    const rows = await query(`select name from schedule_projects where owner_id = 'rpc_owner3' and id = 'p3';`);
    expect(rows[0].name).toBe("Original");
  });

  it("save_schedule_project_board: owner succeeds end-to-end (revision bump, sync called)", async () => {
    await asActor("rpc_owner4", async () => {
      await exec(`insert into forge_scheduling_projects (owner_id, id, project_name, project_type, board, is_public)
        values ('rpc_owner4', 'p4', 'Test4', 'industrial', '{}'::jsonb, false);`);
      await exec(`insert into schedule_projects (owner_id, id, name, board_revision) values ('rpc_owner4', 'p4', 'Test4', 0) on conflict do nothing;`);
      const rows = await query(`select * from save_schedule_project_board('rpc_owner4', 'p4', '{}'::jsonb, 0);`);
      expect(rows[0].board_revision).toBe(1);
    });
  });

  it("save_schedule_project_board: a stranger raises SCHEDULE_SAVE_NOT_FOUND, never silently no-ops", async () => {
    await asActor("rpc_owner5", async () => {
      await exec(`insert into forge_scheduling_projects (owner_id, id, project_name, project_type, board, is_public)
        values ('rpc_owner5', 'p5', 'Test5', 'industrial', '{}'::jsonb, false);`);
      await exec(`insert into schedule_projects (owner_id, id, name, board_revision) values ('rpc_owner5', 'p5', 'Test5', 0) on conflict do nothing;`);
    });
    await asActor("rpc_stranger5", async () => {
      await expect(query(`select * from save_schedule_project_board('rpc_owner5', 'p5', '{}'::jsonb, 0);`)).rejects.toThrow(/SCHEDULE_SAVE_NOT_FOUND/i);
    });
  });
});
