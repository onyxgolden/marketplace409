// Real-infrastructure migration test for the payment_webhook_events explicit privilege contract,
// run against a local Supabase stack (Postgres + GoTrue) via Docker -- never against the real,
// hosted project. Mirrors 20260912000100_revoke_reservation_anonymous_privileges.migration.
// test.js's pattern: real synthetic users, real signed-in sessions, real role-scoped calls --
// never the postgres superuser role, for any assertion about what anon/authenticated/service_role
// can or cannot do.
//
// Requires a local Supabase stack reachable at 127.0.0.1:54321/54322 (e.g. `supabase start` from
// any worktree of this repo). Self-skips (not fails) when that stack isn't reachable.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

const LOCAL_URL = "http://127.0.0.1:54321";
// Well-known, publicly documented Supabase CLI local-dev demo keys -- identical on every
// `supabase start` unless explicitly overridden, never secrets.
const LOCAL_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const LOCAL_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_marketplace409-reservation-validation";
const TEST_PASSWORD = "correct-horse-battery-staple-1";

const currentFilePath = fileURLToPath(import.meta.url);
const migrationPath = path.resolve(path.dirname(currentFilePath), "../20260912010000_establish_payment_webhook_events_grant_contract.sql");
const migrationSql = fs.readFileSync(migrationPath, "utf8");

const FUNCTION_SIGNATURES = [
  "process_stripe_rental_payment_event(text, text, text, text, text, text, text, timestamptz, text)",
  "process_stripe_rental_refund_event(text, text, text, bigint, timestamptz, text)",
  "record_stripe_rental_settlement(text, text, text, text, bigint, bigint, bigint, text, text, timestamptz, text)",
  "mark_stripe_rental_settlements_paid_out(text, text, text, text[], timestamptz, text)",
];

function runPsqlOnce(sql) {
  return execFileSync("docker", ["exec", "-i", DB_CONTAINER, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], {
    input: sql, encoding: "utf8",
  });
}

// See the sibling RV-A migration test for why this retries: multiple integration test files
// share this one local Postgres instance across concurrent vitest workers, and this file's own
// DDL can occasionally collide with another file's own concurrent GRANT/REVOKE on an unrelated
// object, which Postgres reports as "tuple concurrently updated" -- never a partial apply.
function psql(sql, attemptsRemaining = 3) {
  try {
    return runPsqlOnce(sql);
  } catch (error) {
    const message = `${error?.stderr || error?.message || ""}`;
    if (attemptsRemaining > 1 && message.includes("tuple concurrently updated")) {
      execFileSync("sleep", ["0.2"]);
      return psql(sql, attemptsRemaining - 1);
    }
    throw error;
  }
}

async function isLocalStackReachable() {
  try {
    const response = await fetch(`${LOCAL_URL}/auth/v1/health`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

const reachable = await isLocalStackReachable();

describe.skipIf(!reachable)("payment_webhook_events explicit grant contract (real local Supabase)", () => {
  const admin = createClient(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const anonClient = createClient(LOCAL_URL, LOCAL_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  let someUser;
  let someUserClient;
  const suffix = crypto.randomUUID().slice(0, 8);

  async function signInFreshClient(email) {
    const client = createClient(LOCAL_URL, LOCAL_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
    if (error) throw error;
    return client;
  }

  // Restores the exact vulnerable baseline this migration closes -- full anon/authenticated/
  // service_role table privileges (matching this project's real ambient default-ACL behavior,
  // confirmed live against production) and unrestricted function EXECUTE -- regardless of what
  // the real migration history in this local database already did, so this file's own
  // before/after proof is self-contained and deterministic.
  beforeAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50 + Math.floor(Math.random() * 250)));

    psql(`
      grant select, insert, update, delete, references, trigger, truncate on payment_webhook_events to anon, authenticated, service_role;
      ${FUNCTION_SIGNATURES.map((signature) => `grant execute on function ${signature} to public, anon, authenticated, service_role;`).join("\n      ")}
    `);

    const suffixUsers = crypto.randomUUID().slice(0, 8);
    const created = await admin.auth.admin.createUser({ email: `webhook-grant-test-${suffixUsers}@example.test`, password: TEST_PASSWORD, email_confirm: true });
    if (created.error) throw created.error;
    someUser = created.data.user;
    someUserClient = await signInFreshClient(someUser.email);
  }, 30000);

  afterAll(async () => {
    if (!reachable) return;
    psql(`delete from payment_webhook_events where object_id like 'webhook_grant_probe_${suffix}%';`);
    if (someUser) {
      const { error } = await admin.auth.admin.deleteUser(someUser.id);
      if (error) throw new Error(`Failed to delete test user ${someUser.email}: ${error.message}`);
    }
  }, 30000);

  describe("before the migration: the vulnerable baseline genuinely exists", () => {
    it("anon can currently SELECT and mutate payment_webhook_events directly by raw privilege", async () => {
      const selectResult = await anonClient.from("payment_webhook_events").select("id").limit(1);
      expect(selectResult.error).toBeNull();

      // RLS (forced, zero policies) still denies the actual row -- this proves the GRANT itself
      // is present without depending on any row existing to observe a real mutation succeeding.
      const insertResult = await anonClient.from("payment_webhook_events").insert({
        id: `webhook_grant_probe_${suffix}_anon_before`, provider: "stripe", provider_event_id: `evt_probe_before_${suffix}`,
        event_type: "test", status: "received", payload_hash: "probe",
      });
      expect(insertResult.error.message).toMatch(/row-level security policy/);
    });
  });

  describe("applying the real migration file", () => {
    it("applies cleanly, twice in a row, with no error and no privilege drift", () => {
      const snapshotGrants = () => psql(`
        select coalesce(string_agg(distinct grantee, ',' order by grantee), '')
        from information_schema.role_table_grants
        where table_schema='public' and table_name='payment_webhook_events' and grantee in ('anon','authenticated');
      `);
      expect(() => psql(migrationSql)).not.toThrow();
      const firstPass = snapshotGrants();
      expect(() => psql(migrationSql)).not.toThrow();
      const secondPass = snapshotGrants();
      expect(firstPass).toBe(secondPass);
      expect(firstPass.trim().split("\n")[2].trim()).toBe("");
    });

    it("changes no existing webhook-event row", () => {
      // Scoped to one canary row this test controls, not a global count/checksum: this table is
      // shared with stripePaymentChain.integration.test.js and rentalPaymentChain.integration.
      // test.js, which insert and update their own real fixture rows in this same table while
      // running concurrently in separate vitest workers. A global snapshot would (and, before
      // this fix, empirically did) fail on nothing but that legitimate concurrent activity.
      const canaryId = `webhook_grant_probe_${suffix}_canary`;
      psql(`
        insert into payment_webhook_events (id, provider, provider_event_id, provider_mode, event_type, status, payload_hash, received_at, processed_at)
        values ('${canaryId}', 'stripe', 'evt_canary_${suffix}', 'test', 'test', 'processed', 'canary', '2026-01-01T00:00:00Z', '2026-01-01T00:00:01Z')
        on conflict (id) do nothing;
      `);
      const snapshot = () => psql(`
        select id::text || '|' || status || '|' || received_at::text || '|' || processed_at::text
        from payment_webhook_events where id = '${canaryId}';
      `);
      const before = snapshot();
      psql(migrationSql);
      const after = snapshot();
      expect(after).toBe(before);
      psql(`delete from payment_webhook_events where id = '${canaryId}';`);
    });
  });

  describe("after the migration: only service_role retains exactly SELECT/INSERT/UPDATE", () => {
    beforeAll(() => {
      psql(migrationSql);
    });

    it("1. PUBLIC, anon, and authenticated hold zero table privileges", () => {
      const output = psql(`
        select coalesce(string_agg(distinct table_name || ':' || grantee, ','), '')
        from information_schema.role_table_grants
        where table_schema='public' and table_name='payment_webhook_events' and grantee in ('anon','authenticated','PUBLIC');
      `);
      expect(output.trim().split("\n")[2].trim()).toBe("");
    });

    it("2. anonymous direct SELECT is denied by privilege", async () => {
      const result = await anonClient.from("payment_webhook_events").select("id").limit(1);
      expect(result.error).toBeTruthy();
      expect(result.error.code).toBe("42501");
      expect(result.error.message).toMatch(/permission denied for table payment_webhook_events/);
    });

    it("3. anonymous direct INSERT fails by privilege", async () => {
      const result = await anonClient.from("payment_webhook_events").insert({
        id: `webhook_grant_probe_${suffix}_anon_after`, provider: "stripe", provider_event_id: `evt_probe_after_${suffix}`,
        event_type: "test", status: "received", payload_hash: "probe",
      });
      expect(result.error.code).toBe("42501");
    });

    it("4. an authenticated user with no special role also has zero table access -- no user-facing policy was added", async () => {
      const selectResult = await someUserClient.from("payment_webhook_events").select("id").limit(1);
      expect(selectResult.error.code).toBe("42501");

      const insertResult = await someUserClient.from("payment_webhook_events").insert({
        id: `webhook_grant_probe_${suffix}_auth_after`, provider: "stripe", provider_event_id: `evt_probe_auth_${suffix}`,
        event_type: "test", status: "received", payload_hash: "probe",
      });
      expect(insertResult.error.code).toBe("42501");
    });

    it("5. service_role retains SELECT, INSERT, and UPDATE -- the exact minimum production code uses", async () => {
      const insertResult = await admin.from("payment_webhook_events").insert({
        id: `webhook_grant_probe_${suffix}_svc`, provider: "stripe", provider_event_id: `evt_probe_svc_${suffix}`,
        event_type: "payment_intent.succeeded", status: "received", payload_hash: "probe", provider_mode: "test",
      }).select().single();
      expect(insertResult.error).toBeNull();

      const selectResult = await admin.from("payment_webhook_events").select("status").eq("id", insertResult.data.id).single();
      expect(selectResult.error).toBeNull();
      expect(selectResult.data.status).toBe("received");

      const updateResult = await admin.from("payment_webhook_events").update({ status: "processed", processed_at: new Date().toISOString() })
        .eq("id", insertResult.data.id).select().single();
      expect(updateResult.error).toBeNull();
      expect(updateResult.data.status).toBe("processed");
    });

    it("6. service_role does NOT retain DELETE -- not required by any production code path or JS-client test path", () => {
      const output = psql(`
        select has_table_privilege('service_role', 'payment_webhook_events', 'DELETE') as can_delete,
               has_table_privilege('service_role', 'payment_webhook_events', 'TRUNCATE') as can_truncate,
               has_table_privilege('service_role', 'payment_webhook_events', 'REFERENCES') as can_reference,
               has_table_privilege('service_role', 'payment_webhook_events', 'TRIGGER') as can_trigger;
      `);
      const values = output.trim().split("\n")[2].split("|").map((value) => value.trim());
      expect(values).toEqual(["f", "f", "f", "f"]);
    });

    it("7. PUBLIC and anon cannot execute any of the four functions that touch this table; authenticated cannot either", () => {
      const checks = FUNCTION_SIGNATURES.map((signature, index) => `
        has_function_privilege('public', '${signature}', 'EXECUTE') as public_${index},
        has_function_privilege('anon', '${signature}', 'EXECUTE') as anon_${index},
        has_function_privilege('authenticated', '${signature}', 'EXECUTE') as auth_${index},
        has_function_privilege('service_role', '${signature}', 'EXECUTE') as svc_${index}
      `).join(",\n");
      const output = psql(`select\n${checks};`);
      const values = output.trim().split("\n")[2].split("|").map((value) => value.trim());
      // 4 functions x 4 roles: public/anon/authenticated must all be false, service_role true.
      for (let index = 0; index < FUNCTION_SIGNATURES.length; index += 1) {
        const [publicX, anonX, authX, svcX] = values.slice(index * 4, index * 4 + 4);
        expect([publicX, anonX, authX, svcX]).toEqual(["f", "f", "f", "t"]);
      }
    });
  });
});
