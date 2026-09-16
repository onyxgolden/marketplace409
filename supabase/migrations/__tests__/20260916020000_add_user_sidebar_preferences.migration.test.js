import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const LOCAL_URL = "http://127.0.0.1:54321";
const DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_marketplace409-reservation-validation";
const migrationPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../20260916020000_add_user_sidebar_preferences.sql");
const migrationSql = fs.readFileSync(migrationPath, "utf8");

function psql(sql) {
  return execFileSync("docker", ["exec", "-i", DB_CONTAINER, "psql", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], {
    input: sql, encoding: "utf8",
  });
}

function asAuthenticated(userId, sql, { commit = true } = {}) {
  return psql(`begin;
    set local role authenticated;
    select set_config('request.jwt.claim.sub', '${userId}', true);
    select set_config('request.jwt.claim.role', 'authenticated', true);
    ${sql}
    ${commit ? "commit" : "rollback"};`);
}

function asAnon(sql) {
  return psql(`begin;
    set local role anon;
    ${sql}
    rollback;`);
}

// asAuthenticated/asAnon wrap the real query in BEGIN/SET/set_config/.../COMMIT|ROLLBACK -- with
// -At (tuples-only), each of those statements prints its own line too, so the real result sits
// second-to-last, just before the final COMMIT/ROLLBACK line.
function lastResultLine(output) {
  const lines = output.trim().split("\n");
  return lines.at(-2) ?? "";
}

async function reachable() {
  try {
    return (await fetch(`${LOCAL_URL}/auth/v1/health`, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}

const localStackReachable = await reachable();

describe.skipIf(!localStackReachable)("user_sidebar_preferences (real local Supabase)", () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const ownerUserId = crypto.randomUUID();
  const strangerUserId = crypto.randomUUID();

  beforeAll(() => {
    // Applying twice up front doubles as the idempotent-reapply proof this session's migrations
    // are held to: no drift, no error, same end state.
    psql(`${migrationSql}\n${migrationSql}`);
    psql(`
      insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      values
        ('00000000-0000-0000-0000-000000000000','${ownerUserId}','authenticated','authenticated','sidebar-owner-${suffix}@example.test','',now(),'{}','{}',now(),now()),
        ('00000000-0000-0000-0000-000000000000','${strangerUserId}','authenticated','authenticated','sidebar-stranger-${suffix}@example.test','',now(),'{}','{}',now(),now());
    `);
  }, 30000);

  afterAll(() => {
    if (!localStackReachable) return;
    psql(`
      delete from user_sidebar_preferences where user_id in ('${ownerUserId}','${strangerUserId}');
      delete from auth.users where id in ('${ownerUserId}','${strangerUserId}');
    `);
  }, 30000);

  it("grants authenticated exactly select/insert/update, never delete, and nothing to anon/public/service_role", () => {
    const output = psql(`select grantee, string_agg(privilege_type, ',' order by privilege_type)
      from information_schema.role_table_grants
      where table_name = 'user_sidebar_preferences' and table_schema = 'public'
        and grantee in ('public','anon','authenticated','service_role')
      group by grantee order by grantee;`);
    expect(output.trim()).toBe("authenticated|INSERT,SELECT,UPDATE");
  });

  it("enables and forces row level security", () => {
    const output = psql(`select relrowsecurity, relforcerowsecurity from pg_class
      where relname = 'user_sidebar_preferences';`);
    expect(output.trim()).toBe("t|t");
  });

  it("denies anon any access at all", () => {
    expect(() => asAnon(`select * from user_sidebar_preferences limit 1;`)).toThrow();
    expect(() => asAnon(`insert into user_sidebar_preferences(user_id, sidebar_key, hidden_item_ids)
      values ('${ownerUserId}', 'rental-manager', '["support"]'::jsonb);`)).toThrow();
  });

  it("lets the owning user upsert and read their own row", () => {
    asAuthenticated(ownerUserId, `insert into user_sidebar_preferences(user_id, sidebar_key, hidden_item_ids)
      values ('${ownerUserId}', 'rental-manager', '["support","rentec-migration"]'::jsonb)
      on conflict (user_id, sidebar_key) do update set hidden_item_ids = excluded.hidden_item_ids, updated_at = now();`);
    const output = asAuthenticated(ownerUserId, `select hidden_item_ids::text from user_sidebar_preferences
      where user_id = '${ownerUserId}' and sidebar_key = 'rental-manager';`);
    expect(lastResultLine(output)).toBe('["support", "rentec-migration"]');
  });

  it("denies an unrelated authenticated user from reading or writing someone else's row", () => {
    const output = asAuthenticated(strangerUserId, `select count(*) from user_sidebar_preferences
      where user_id = '${ownerUserId}';`);
    expect(lastResultLine(output)).toBe("0");
    expect(() => asAuthenticated(strangerUserId, `update user_sidebar_preferences
      set hidden_item_ids = '[]'::jsonb where user_id = '${ownerUserId}' and sidebar_key = 'rental-manager';`))
      .not.toThrow(); // affects 0 rows, RLS-filtered -- not an error, just a no-op
    const stillHidden = asAuthenticated(ownerUserId, `select hidden_item_ids::text from user_sidebar_preferences
      where user_id = '${ownerUserId}' and sidebar_key = 'rental-manager';`);
    expect(lastResultLine(stillHidden)).toBe('["support", "rentec-migration"]');
  });

  it("resets to default via an upsert to an empty array, not a delete", () => {
    asAuthenticated(ownerUserId, `insert into user_sidebar_preferences(user_id, sidebar_key, hidden_item_ids)
      values ('${ownerUserId}', 'rental-manager', '[]'::jsonb)
      on conflict (user_id, sidebar_key) do update set hidden_item_ids = excluded.hidden_item_ids, updated_at = now();`);
    const output = asAuthenticated(ownerUserId, `select hidden_item_ids::text from user_sidebar_preferences
      where user_id = '${ownerUserId}' and sidebar_key = 'rental-manager';`);
    expect(lastResultLine(output)).toBe("[]");
    expect(() => asAuthenticated(ownerUserId, `delete from user_sidebar_preferences
      where user_id = '${ownerUserId}' and sidebar_key = 'rental-manager';`)).toThrow();
  });

  it("rejects a sidebar_key that fails the lowercase-slug check constraint", () => {
    expect(() => asAuthenticated(ownerUserId, `insert into user_sidebar_preferences(user_id, sidebar_key, hidden_item_ids)
      values ('${ownerUserId}', 'Not Valid!', '[]'::jsonb);`)).toThrow();
  });

  it("rejects a non-array hidden_item_ids value", () => {
    expect(() => asAuthenticated(ownerUserId, `insert into user_sidebar_preferences(user_id, sidebar_key, hidden_item_ids)
      values ('${ownerUserId}', 'financial', '{"not":"an array"}'::jsonb);`)).toThrow();
  });

  it("keeps two different sidebar_keys for the same user fully independent", () => {
    asAuthenticated(ownerUserId, `insert into user_sidebar_preferences(user_id, sidebar_key, hidden_item_ids)
      values ('${ownerUserId}', 'financial', '["reports"]'::jsonb)
      on conflict (user_id, sidebar_key) do update set hidden_item_ids = excluded.hidden_item_ids;`);
    const rental = asAuthenticated(ownerUserId, `select hidden_item_ids::text from user_sidebar_preferences
      where user_id = '${ownerUserId}' and sidebar_key = 'rental-manager';`);
    const financial = asAuthenticated(ownerUserId, `select hidden_item_ids::text from user_sidebar_preferences
      where user_id = '${ownerUserId}' and sidebar_key = 'financial';`);
    expect(lastResultLine(rental)).toBe("[]");
    expect(lastResultLine(financial)).toBe('["reports"]');
    // Cleanup via the superuser connection (plain psql(), not asAuthenticated) -- authenticated
    // has no DELETE grant, proven above, and that's correct: production cleanup is never this
    // role's job either.
    psql(`delete from user_sidebar_preferences where user_id = '${ownerUserId}' and sidebar_key = 'financial';`);
  });
});
