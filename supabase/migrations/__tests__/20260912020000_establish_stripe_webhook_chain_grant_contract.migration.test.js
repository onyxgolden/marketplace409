// Real-infrastructure migration test for the Stripe payment-webhook-chain explicit privilege
// contract, run against a local Supabase stack (Postgres + GoTrue) via Docker -- never against the
// real, hosted project. Mirrors 20260912000100_revoke_reservation_anonymous_privileges.migration.
// test.js's pattern: real synthetic users, real signed-in sessions, real role-scoped calls --
// never the postgres superuser role, for any assertion about what anon/authenticated/service_role
// can or cannot do. Supersedes 20260912010000_establish_payment_webhook_events_grant_contract.
// migration.test.js (payment_webhook_events-only). Covers twelve tables in two domains that share
// the same webhook route: the seven rental-payment tables (their own full REVOKE-ALL-then-GRANT
// contract, see TABLES below) plus five additive grants proven necessary by chain-walking the two
// integration test files' real permission errors one at a time: private_financing_online_payments,
// private_financing_events, private_financing_components, private_financing_account_terms_versions
// (authenticated read plus the independently-derived service_role operations), and rental_tenants
// (authenticated CRUD plus service_role read, preserving existing Rental Manager and payment-
// session callers -- see its own describe block).
// Deliberately excludes financial_events (no production service_role reader exists anywhere in
// this codebase; its own test-verification need was fixed by rewriting the test to read via the
// local Postgres administrator instead -- see rentalPaymentChain.integration.test.js), and
// rental_lease_tenants/rent_schedules (both belong to the tenant-autopay RPC's own separate,
// unfixed RLS defect -- deferred to a dedicated future PR).
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
const migrationPath = path.resolve(path.dirname(currentFilePath), "../20260912020000_establish_stripe_webhook_chain_grant_contract.sql");
const migrationSql = fs.readFileSync(migrationPath, "utf8");

// Per-table expected steady-state grants (post-migration), independently derived per the
// migration's own comments -- deliberately not a single blanket set.
const TABLES = {
  payment_webhook_events: { authenticated: [], service_role: ["SELECT", "INSERT", "UPDATE"] },
  landlord_payment_accounts: { authenticated: ["SELECT"], service_role: ["SELECT", "INSERT", "UPDATE"] },
  rental_payments: { authenticated: ["SELECT", "INSERT"], service_role: ["SELECT", "INSERT", "UPDATE"] },
  rental_settlements: { authenticated: ["SELECT"], service_role: ["SELECT", "INSERT", "UPDATE"] },
  rent_charges: { authenticated: ["SELECT", "INSERT", "UPDATE"], service_role: ["SELECT", "INSERT", "UPDATE"] },
  rental_autopay_enrollments: { authenticated: ["SELECT", "INSERT", "UPDATE"], service_role: ["SELECT", "UPDATE"] },
  ach_authorizations: { authenticated: [], service_role: [] },
};
const ALL_TABLES = Object.keys(TABLES);

// Five shared dependencies have their own exact, fully-normalized contracts. The authenticated
// reads preserve existing owner/borrower routes; service_role gets only the webhook/portal-server
// operations proven by production call sites. rental_tenants is asserted separately because its
// existing Rental Manager CRUD surface is intentionally broader than a payment table's surface.
const SHARED_TABLES = {
  private_financing_online_payments: { authenticated: ["SELECT"], service_role: ["SELECT", "INSERT", "UPDATE"] },
  private_financing_events: { authenticated: ["SELECT"], service_role: ["SELECT"] },
  private_financing_components: { authenticated: ["SELECT"], service_role: ["SELECT"] },
  private_financing_account_terms_versions: { authenticated: ["SELECT"], service_role: ["SELECT"] },
};
const SHARED_TABLE_NAMES = Object.keys(SHARED_TABLES);

// Minimal, schema-valid insert payload per table so a denied INSERT fails on privilege/RLS, never
// on an unrelated "column does not exist" parse error (Postgres resolves columns before checking
// privileges, so a malformed payload would mask the very check these tests exist to make).
function probeInsertRow(table, ownerId, id) {
  if (table === "payment_webhook_events") {
    return { id, provider: "stripe", provider_event_id: `evt_${id}`, event_type: "test", status: "received", payload_hash: "probe" };
  }
  if (table === "landlord_payment_accounts") {
    return { owner_id: ownerId, id, provider: "stripe", status: "not_started" };
  }
  if (table === "rental_payments") {
    return { owner_id: ownerId, id, charge_id: "nonexistent", lease_id: "nonexistent", tenant_id: "nonexistent", provider: "stripe", amount_cents: 100, currency_code: "USD", status: "created", idempotency_key: id };
  }
  if (table === "rental_settlements") {
    return { owner_id: ownerId, id, payment_id: "nonexistent", provider: "stripe", gross_amount_cents: 100, fee_amount_cents: 0, net_amount_cents: 100, currency_code: "USD", status: "pending" };
  }
  if (table === "rent_charges") {
    return { owner_id: ownerId, id, lease_id: "nonexistent", schedule_id: "nonexistent", period: "2026-02", due_date: "2026-02-01", amount_cents: 100, currency_code: "USD", status: "due", source_key: id };
  }
  if (table === "rental_autopay_enrollments") {
    return { owner_id: ownerId, id, lease_id: "nonexistent", tenant_id: "nonexistent", payment_method_type: "card", charge_day: 1, consent_text: "x".repeat(40), consented_at: new Date().toISOString() };
  }
  if (table === "ach_authorizations") {
    return { owner_id: ownerId, id, tenant_id: "nonexistent", lease_id: "nonexistent", provider: "stripe", provider_customer_id: "x", provider_payment_method_id: "x", mandate_reference: id, authorization_text_version: "v1", authorized_at: new Date().toISOString(), status: "active" };
  }
  throw new Error(`No probe payload defined for ${table}`);
}

const FUNCTION_SIGNATURES = [
  "process_stripe_rental_payment_event(text, text, text, text, text, text, text, timestamptz, text)",
  "process_stripe_rental_refund_event(text, text, text, bigint, timestamptz, text)",
  "record_stripe_rental_settlement(text, text, text, text, bigint, bigint, bigint, text, text, timestamptz, text)",
  "mark_stripe_rental_settlements_paid_out(text, text, text, text[], timestamptz, text)",
  "activate_rental_autopay_from_payment(text, text, text, text, text)",
];
const PRIVATE_FINANCING_FUNCTION_SIGNATURES = [
  "complete_private_financing_stripe_payment(text, text, bigint, date, jsonb, jsonb, bigint, jsonb, text)",
  "update_private_financing_stripe_payment_status(text, text, text, text, text)",
  "credit_private_financing_stripe_fee(text, text, bigint, bigint, date, text, bigint)",
  "reverse_private_financing_stripe_payment(text, text, text, bigint, date, jsonb, jsonb, bigint, jsonb)",
];
const SERVICE_ROLE_ONLY_FUNCTIONS = [...FUNCTION_SIGNATURES, ...PRIVATE_FINANCING_FUNCTION_SIGNATURES];
const AUTHENTICATED_ONLY_FUNCTIONS = [
  "generate_monthly_rent_charge(text, text, text)",
  "void_rental_rent_charge(text, text, text)",
  "record_offline_rental_payment(text, text, text, bigint, timestamptz, text, text)",
  "approve_rentec_payment_import(text, text, text, text, bigint, date, text, text, text, text)",
  "commit_rentec_rental_import(text, jsonb, jsonb, jsonb)",
  "queue_rental_balance_reminder(text, text, timestamptz, text, smallint)",
  "request_rental_autopay_enrollment(text, text, smallint, smallint, text)",
  "cancel_rental_autopay_enrollment(text, text)",
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

function rows(output) {
  return output
    .trim()
    .split("\n")
    .slice(2)
    .filter((line) => !/^\(\d+ rows?\)$/.test(line.trim()) && line.trim() !== "")
    .map((line) => line.split("|").map((v) => v.trim()));
}

// A bare psql result whose only value can legitimately be an empty string (e.g. coalesce(string_
// agg(...), '') over zero matching rows) is printed by psql as a blank line, indistinguishable
// from rows()'s own blank-line-as-noise filter. Wrapping the query's single `select <expr> from`
// expression in sentinel delimiters before it ever reaches psql -- and stripping them back out
// here -- makes an intentionally empty value unambiguous. Expects exactly one `select ... from`.
function scalar(sql) {
  const wrapped = sql.replace(/^(\s*select\s+)([\s\S]+?)(\s+from\s)/i, (_, pre, expr, post) => `${pre}'<<' || (${expr}) || '>>'${post}`);
  const output = psql(wrapped);
  const line = output.trim().split("\n")[2];
  return line.slice(line.indexOf("<<") + 2, line.lastIndexOf(">>"));
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

describe.skipIf(!reachable)("rental payment domain explicit grant contract (real local Supabase)", () => {
  const admin = createClient(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const anonClient = createClient(LOCAL_URL, LOCAL_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomUUID().slice(0, 8);
  let ownerA, ownerAClient, ownerB, ownerBClient;

  async function signInFreshClient(email) {
    const client = createClient(LOCAL_URL, LOCAL_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
    if (error) throw error;
    return client;
  }

  // Restores the exact vulnerable baseline this migration closes -- full anon/authenticated/
  // service_role table privileges on all seven tables (matching this project's real ambient
  // default-ACL behavior, confirmed live against production for payment_webhook_events and
  // structurally identical for its six siblings, all created without an explicit GRANT in the
  // same way) and unrestricted function EXECUTE -- regardless of what the real migration history
  // in this local database already did, so this file's own before/after proof is self-contained.
  beforeAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50 + Math.floor(Math.random() * 250)));

    const grantAllTables = ALL_TABLES.map((table) =>
      `grant select, insert, update, delete, references, trigger, truncate on ${table} to anon, authenticated, service_role;`
    ).join("\n");
    const grantAllFunctions = [...SERVICE_ROLE_ONLY_FUNCTIONS, ...AUTHENTICATED_ONLY_FUNCTIONS]
      .map((signature) => `grant execute on function ${signature} to public, anon, authenticated, service_role;`)
      .join("\n");
    psql(`${grantAllTables}\n${grantAllFunctions}`);

    // Deliberately NOT done here: revoking the five shared dependencies' current privileges to
    // artificially recreate a "before" state. Unlike the seven ALL_TABLES above (where this
    // beforeAll only ever WIDENS privilege, which is safe for any other integration test file
    // running concurrently in a sibling vitest worker against this same shared local Postgres
    // instance), private_financing_online_payments/events/components/account_terms_versions and
    // rental_tenants are live dependencies of other real
    // files (stripePaymentChain.integration.test.js, rentalPaymentChain.integration.test.js)
    // depend on those exact privileges being present throughout the ENTIRE regression run, not
    // just outside this file's own execution window. Revoking them here, even briefly, would race
    // a concurrently-running integration test into a real permission-denied failure that has
    // nothing to do with either file's own correctness -- confirmed by hitting exactly that
    // failure empirically before this comment was written. Their "before" state (service_role/
    // authenticated genuinely lacking these privileges on a stack where this migration has never
    // run) was already proven directly, in isolation, during this contract's own investigation
    // phase; this file only needs to prove the "after" contract and its idempotency below.
    const suffixUsers = crypto.randomUUID().slice(0, 8);
    const createdA = await admin.auth.admin.createUser({ email: `payment-grant-owner-a-${suffixUsers}@example.test`, password: TEST_PASSWORD, email_confirm: true });
    if (createdA.error) throw createdA.error;
    ownerA = createdA.data.user;
    ownerAClient = await signInFreshClient(ownerA.email);

    const createdB = await admin.auth.admin.createUser({ email: `payment-grant-owner-b-${suffixUsers}@example.test`, password: TEST_PASSWORD, email_confirm: true });
    if (createdB.error) throw createdB.error;
    ownerB = createdB.data.user;
    ownerBClient = await signInFreshClient(ownerB.email);
  }, 30000);

  afterAll(async () => {
    if (!reachable) return;
    // Cleanup via the local Postgres superuser (bypasses grants entirely) or transaction-scoped
    // fixture deletes -- never through a widened service_role grant, and never a DELETE grant
    // added to any role merely for test convenience.
    psql(ALL_TABLES.filter((table) => table !== "payment_webhook_events")
      .map((table) => `delete from ${table} where owner_id like 'payment_grant_probe_${suffix}%' or id like 'payment_grant_probe_${suffix}%';`)
      .join("\n"));
    psql(`delete from payment_webhook_events where object_id like 'payment_grant_probe_${suffix}%' or id like 'payment_grant_probe_${suffix}%';`);
    // Fixture rows in tables outside this migration's own scope (created only to satisfy
    // rent_charges' NOT NULL foreign keys in the owner-retention test above).
    psql(`
      delete from rent_schedules where id like 'payment_grant_probe_${suffix}%';
      delete from rental_leases where id like 'payment_grant_probe_${suffix}%';
      delete from rental_units where id like 'payment_grant_probe_${suffix}%';
      delete from rental_tenants where id like 'payment_grant_probe_${suffix}%';
      delete from private_financing_online_payments where id like 'payment_grant_probe_${suffix}%';
      delete from private_financing_accounts where id like 'payment_grant_probe_${suffix}%';
      delete from private_financing_borrowers where id like 'payment_grant_probe_${suffix}%';
    `);
    for (const user of [ownerA, ownerB]) {
      if (!user) continue;
      const { error } = await admin.auth.admin.deleteUser(user.id);
      if (error) throw new Error(`Failed to delete test user ${user.email}: ${error.message}`);
    }
  }, 30000);

  describe("before the migration: the vulnerable baseline genuinely exists on every table", () => {
    it.each(ALL_TABLES)("anon currently holds a raw table grant on %s (a bare SELECT never privilege-errors; RLS silently returns zero rows)", async (table) => {
      const result = await anonClient.from(table).select("*").limit(1);
      expect(result.error, `${table} select should not privilege-error while the vulnerable baseline grant is in place`).toBeNull();
      expect(result.data).toEqual([]);
    });

    it.each(ALL_TABLES)("anon's raw INSERT grant on %s is only stopped by RLS, never by privilege, at this stage", async (table) => {
      const result = await anonClient.from(table).insert(probeInsertRow(table, `payment_grant_probe_${suffix}_before`, `payment_grant_probe_${suffix}_before_${table}`));
      expect(result.error).toBeTruthy();
      expect(result.error.message).not.toMatch(/permission denied for table/);
    });

    // The five shared dependencies' original state (service_role/authenticated genuinely lacking
    // these privileges on a stack where this migration has never run) is deliberately NOT
    // re-proven here via a live revoke: unlike the seven ALL_TABLES above, these five are
    // privileges that stripePaymentChain.integration.test.js and rentalPaymentChain.
    // integration.test.js depend on for real, correct behavior throughout the entire regression
    // run -- revoking them, even briefly, inside a shared beforeAll would race those concurrently-
    // running files into a permission-denied failure with nothing to do with either file's own
    // correctness (confirmed empirically). That "before" state was already proven directly, in
    // isolation, during this contract's own investigation phase -- not repeated here.
  });

  describe("applying the real migration file", () => {
    it("applies cleanly, twice in a row, with no error and no privilege drift", () => {
      const snapshotGrants = () => psql(`
        select table_name, coalesce(string_agg(distinct grantee || ':' || privilege_type, ',' order by grantee || ':' || privilege_type), '')
        from information_schema.role_table_grants
        where table_schema='public' and table_name = any(array[${ALL_TABLES.map((t) => `'${t}'`).join(",")}])
        group by table_name order by table_name;
      `);
      expect(() => psql(migrationSql)).not.toThrow();
      const firstPass = snapshotGrants();
      expect(() => psql(migrationSql)).not.toThrow();
      const secondPass = snapshotGrants();
      expect(firstPass).toBe(secondPass);
    });

    it("changes no existing row in any of the seven tables (scoped canary rows, not a global snapshot)", () => {
      // Scoped to canary rows this test owns, not a global count/checksum: these tables are
      // shared with stripePaymentChain.integration.test.js and rentalPaymentChain.integration.
      // test.js, which insert and update their own real fixture rows in these same tables while
      // running concurrently in separate vitest workers. A global snapshot would (and, for
      // payment_webhook_events before the prior fix, empirically did) fail on nothing but that
      // legitimate concurrent activity.
      const webhookCanaryId = `payment_grant_probe_${suffix}_canary_webhook`;
      psql(`
        insert into payment_webhook_events (id, provider, provider_event_id, provider_mode, event_type, status, payload_hash, received_at, processed_at)
        values ('${webhookCanaryId}', 'stripe', 'evt_canary_${suffix}', 'test', 'test', 'processed', 'canary', '2026-01-01T00:00:00Z', '2026-01-01T00:00:01Z')
        on conflict (id) do nothing;
      `);
      const snapshot = () => psql(`
        select id::text || '|' || status || '|' || received_at::text || '|' || processed_at::text
        from payment_webhook_events where id = '${webhookCanaryId}';
      `);
      const before = snapshot();
      psql(migrationSql);
      const after = snapshot();
      expect(after).toBe(before);
      psql(`delete from payment_webhook_events where id = '${webhookCanaryId}';`);
    });
  });

  describe("after the migration: the independently-derived per-table contract holds exactly", () => {
    beforeAll(() => {
      psql(migrationSql);
    });

    it.each(ALL_TABLES)("%s: PUBLIC and anon hold zero table privileges", (table) => {
      const value = scalar(`
        select coalesce(string_agg(distinct grantee, ','), '')
        from information_schema.role_table_grants
        where table_schema='public' and table_name='${table}' and grantee in ('anon','PUBLIC');
      `);
      expect(value).toBe("");
    });

    it.each(ALL_TABLES)("%s: authenticated holds exactly its derived privilege set", (table) => {
      const value = scalar(`
        select coalesce(string_agg(distinct privilege_type, ',' order by privilege_type), '')
        from information_schema.role_table_grants
        where table_schema='public' and table_name='${table}' and grantee = 'authenticated';
      `);
      const actual = value.split(",").filter(Boolean).sort();
      expect(actual).toEqual([...TABLES[table].authenticated].sort());
    });

    it.each(ALL_TABLES)("%s: service_role holds exactly its derived privilege set (never DELETE)", (table) => {
      const value = scalar(`
        select coalesce(string_agg(distinct privilege_type, ',' order by privilege_type), '')
        from information_schema.role_table_grants
        where table_schema='public' and table_name='${table}' and grantee = 'service_role';
      `);
      const actual = value.split(",").filter(Boolean).sort();
      expect(actual).toEqual([...TABLES[table].service_role].sort());
      expect(actual).not.toContain("DELETE");
    });

    it("anonymous users cannot read or mutate any of the seven payment tables (empirical, real anon client)", async () => {
      for (const table of ALL_TABLES) {
        const selectResult = await anonClient.from(table).select("*").limit(1);
        expect(selectResult.error?.code, `${table} select`).toBe("42501");
        const insertResult = await anonClient.from(table).insert(probeInsertRow(table, `payment_grant_probe_${suffix}`, `payment_grant_probe_${suffix}_anon_${table}`));
        expect(insertResult.error?.code, `${table} insert`).toBe("42501");
      }
    });

    it("an authenticated user with no workspace access to a table's rows still cannot access another workspace's payment data", async () => {
      // ownerA and ownerB are two real, unrelated authenticated users with no co-owner
      // relationship. Since no fixture rows exist for either, this proves privilege-level (not
      // merely row-level) isolation would hold even if ownerB somehow knew ownerA's owner_id.
      const probeOwnerId = ownerA.id;
      for (const table of ["rental_payments", "rent_charges", "rental_settlements", "landlord_payment_accounts", "rental_autopay_enrollments"]) {
        const result = await ownerBClient.from(table).select("*").eq("owner_id", probeOwnerId).limit(1);
        expect(result.error, `${table} cross-workspace select should not privilege-error`).toBeNull();
        expect(result.data, `${table} cross-workspace select must return zero rows under RLS`).toEqual([]);
      }
    });

    it("primary owners retain select, insert, and update on rent_charges under their own workspace-RLS policy", async () => {
      // Deliberately a raw .insert()/.update() against rent_charges alone -- not through an
      // owner-invoked RPC -- to prove the table-level grant plus the pre-existing, unchanged
      // rent_charges_owner_all policy (has_workspace_access) work together, without incidentally
      // depending on any other table's own privilege state. rent_charges' NOT NULL lease_id/
      // schedule_id foreign keys still require real target rows to exist; those are seeded via
      // the local Postgres superuser (fixture setup, not a claim about authenticated's own
      // privileges -- Postgres foreign-key checks do not require the referencing role to hold any
      // privilege on the referenced table).
      const scheduleId = `payment_grant_probe_${suffix}_schedule`;
      const leaseId = `payment_grant_probe_${suffix}_lease`;
      const unitId = `payment_grant_probe_${suffix}_unit`;
      const chargeId = `payment_grant_probe_${suffix}_owner_charge`;
      psql(`
        insert into rental_units (owner_id, id, property_id, label, status) values ('${ownerA.id}', '${unitId}', 'payment_grant_probe_property', 'Unit A', 'occupied') on conflict do nothing;
        insert into rental_leases (owner_id, id, property_id, unit_id, status, start_date, monthly_rent_cents, currency_code, rent_due_day)
        values ('${ownerA.id}', '${leaseId}', 'payment_grant_probe_property', '${unitId}', 'active', '2026-01-01', 150000, 'USD', 1) on conflict do nothing;
        insert into rent_schedules (owner_id, id, lease_id, status, amount_cents, currency_code, due_day, effective_start_date)
        values ('${ownerA.id}', '${scheduleId}', '${leaseId}', 'active', 150000, 'USD', 1, '2026-01-01') on conflict do nothing;
      `);

      const inserted = await ownerAClient.from("rent_charges").insert({
        owner_id: ownerA.id, id: chargeId, lease_id: leaseId, schedule_id: scheduleId, period: "2026-02",
        due_date: "2026-02-01", amount_cents: 150000, currency_code: "USD", status: "due", source_key: chargeId,
      }).select().single();
      expect(inserted.error).toBeNull();

      const selected = await ownerAClient.from("rent_charges").select("*").eq("owner_id", ownerA.id).eq("id", chargeId).single();
      expect(selected.error).toBeNull();

      const updated = await ownerAClient.from("rent_charges").update({ status: "void", voided_at: new Date().toISOString() })
        .eq("owner_id", ownerA.id).eq("id", chargeId).select().single();
      expect(updated.error).toBeNull();
      expect(updated.data.status).toBe("void");
    });

    it("direct writes are denied where RPC-only mutation is intended (rent_charges direct insert bypassing the RPC)", async () => {
      // authenticated holds the table-level INSERT privilege (required by generate_monthly_rent_
      // charge above), but a raw .insert() must still satisfy rent_charges_owner_all's WITH CHECK
      // (has_workspace_access) -- for a row with no real schedule/lease FK target, the insert
      // fails on the foreign-key/check constraints the RPC itself satisfies, proving privilege
      // alone is not a bypass of the table's real invariants.
      const result = await ownerAClient.from("rent_charges").insert({
        owner_id: ownerA.id, id: `payment_grant_probe_${suffix}_direct_charge`, lease_id: "nonexistent",
        schedule_id: "nonexistent", period: "2026-02", due_date: "2026-02-01", amount_cents: 100,
        currency_code: "USD", status: "due", source_key: `payment_grant_probe_${suffix}_direct`,
      });
      expect(result.error).toBeTruthy();
    });

    it("service-role webhook processing can select, insert, and upsert on payment_webhook_events (real RPC path, unauthorized roles rejected)", async () => {
      const insertResult = await admin.from("payment_webhook_events").insert({
        id: `payment_grant_probe_${suffix}_svc_webhook`, provider: "stripe", provider_event_id: `evt_probe_svc_${suffix}`,
        event_type: "payment_intent.succeeded", status: "received", payload_hash: "probe", provider_mode: "test",
      }).select().single();
      expect(insertResult.error).toBeNull();
      const updateResult = await admin.from("payment_webhook_events").update({ status: "processed", processed_at: new Date().toISOString() })
        .eq("id", insertResult.data.id).select().single();
      expect(updateResult.error).toBeNull();
      expect(updateResult.data.status).toBe("processed");

      // Every relevant function rejects unauthorized roles.
      const rpcArgs = {
        p_provider_event_id: "x", p_connected_account_id: "x", p_event_type: "payment_intent.succeeded",
        p_object_id: "x", p_payment_id: "x", p_occurred_at: new Date().toISOString(), p_provider_mode: "test",
      };
      const anonCall = await anonClient.rpc("process_stripe_rental_payment_event", rpcArgs);
      expect(anonCall.error).toBeTruthy();
      const authCall = await ownerAClient.rpc("process_stripe_rental_payment_event", rpcArgs);
      expect(authCall.error).toBeTruthy();
    });

    it("no production path requires service-role delete on any of the seven tables", () => {
      const checks = ALL_TABLES.map((table) => `has_table_privilege('service_role', '${table}', 'DELETE') as ${table}`).join(",\n");
      const output = psql(`select\n${checks};`);
      const values = rows(output)[0];
      expect(values).toEqual(ALL_TABLES.map(() => "f"));
    });

    it(`function EXECUTE matrix: service-role-only functions reject public/anon/authenticated`, () => {
      const checks = SERVICE_ROLE_ONLY_FUNCTIONS.map((signature, index) => `
        has_function_privilege('public', '${signature}', 'EXECUTE') as public_${index},
        has_function_privilege('anon', '${signature}', 'EXECUTE') as anon_${index},
        has_function_privilege('authenticated', '${signature}', 'EXECUTE') as auth_${index},
        has_function_privilege('service_role', '${signature}', 'EXECUTE') as svc_${index}
      `).join(",\n");
      const output = psql(`select\n${checks};`);
      const values = rows(output)[0];
      for (let index = 0; index < SERVICE_ROLE_ONLY_FUNCTIONS.length; index += 1) {
        const [publicX, anonX, authX, svcX] = values.slice(index * 4, index * 4 + 4);
        expect([publicX, anonX, authX, svcX], SERVICE_ROLE_ONLY_FUNCTIONS[index]).toEqual(["f", "f", "f", "t"]);
      }
    });

    it("function EXECUTE matrix: authenticated-only functions reject public/anon, service_role has no unintended grant", () => {
      const checks = AUTHENTICATED_ONLY_FUNCTIONS.map((signature, index) => `
        has_function_privilege('public', '${signature}', 'EXECUTE') as public_${index},
        has_function_privilege('anon', '${signature}', 'EXECUTE') as anon_${index},
        has_function_privilege('authenticated', '${signature}', 'EXECUTE') as auth_${index}
      `).join(",\n");
      const output = psql(`select\n${checks};`);
      const values = rows(output)[0];
      for (let index = 0; index < AUTHENTICATED_ONLY_FUNCTIONS.length; index += 1) {
        const [publicX, anonX, authX] = values.slice(index * 3, index * 3 + 3);
        expect([publicX, anonX, authX], AUTHENTICATED_ONLY_FUNCTIONS[index]).toEqual(["f", "f", "t"]);
      }
    });

    it("ach_authorizations has zero grants for every role -- confirmed dead code, not an oversight", () => {
      const value = scalar(`
        select coalesce(string_agg(distinct grantee, ','), '')
        from information_schema.role_table_grants
        where table_schema='public' and table_name='ach_authorizations' and grantee in ('anon','authenticated','service_role','PUBLIC');
      `);
      expect(value).toBe("");
    });

    it("test cleanup succeeds without broadening production privileges (superuser path, not a widened grant)", () => {
      const probeId = `payment_grant_probe_${suffix}_cleanup_check`;
      psql(`
        insert into payment_webhook_events (id, provider, provider_event_id, provider_mode, event_type, status, payload_hash)
        values ('${probeId}', 'stripe', 'evt_${probeId}', 'test', 'test', 'received', 'probe');
      `);
      // Cleanup goes through the local Postgres superuser (docker exec ... psql), never through
      // a DELETE grant on service_role or authenticated -- both remain without DELETE afterward.
      psql(`delete from payment_webhook_events where id = '${probeId}';`);
      const remaining = psql(`select count(*)::text from payment_webhook_events where id = '${probeId}';`);
      expect(rows(remaining)[0][0]).toBe("0");
      const svcDelete = psql(`select has_table_privilege('service_role', 'payment_webhook_events', 'DELETE');`);
      expect(rows(svcDelete)[0][0]).toBe("f");
    });
  });

  describe("the five shared dependencies: complete explicit contracts", () => {
    // The migration is already genuinely applied by this point -- the earlier sibling describe
    // ("after the migration: the independently-derived per-table contract holds exactly") already
    // ran psql(migrationSql) in its own beforeAll, and that state persists for every later sibling
    // describe in this same file. The real "before" proof for these five additions runs earlier,
    // inside "before the migration: the vulnerable baseline genuinely exists on every table",
    // before any beforeAll in this file has applied the migration.
    it.each(SHARED_TABLE_NAMES)("%s: every role holds exactly its derived privilege set", (table) => {
      for (const role of ["PUBLIC", "anon", "authenticated", "service_role"]) {
        const value = scalar(`
          select coalesce(string_agg(distinct privilege_type, ',' order by privilege_type), '')
          from information_schema.role_table_grants
          where table_schema='public' and table_name='${table}' and grantee = '${role}';
        `);
        const actual = value.split(",").filter(Boolean).sort();
        const expected = role === "authenticated" || role === "service_role" ? SHARED_TABLES[table][role] : [];
        expect(actual, `${table}:${role}`).toEqual([...expected].sort());
      }
    });

    it("rental_tenants: authenticated CRUD and service-role SELECT are exact; PUBLIC/anon hold nothing", () => {
      const expectedByRole = {
        PUBLIC: [], anon: [], authenticated: ["SELECT", "INSERT", "UPDATE", "DELETE"], service_role: ["SELECT"],
      };
      for (const [role, expected] of Object.entries(expectedByRole)) {
        const value = scalar(`
          select coalesce(string_agg(distinct privilege_type, ',' order by privilege_type), '')
          from information_schema.role_table_grants
          where table_schema='public' and table_name='rental_tenants' and grantee = '${role}';
        `);
        expect(value.split(",").filter(Boolean).sort(), role).toEqual([...expected].sort());
      }
    });

    it("rental_tenants: the existing owner CRUD workflow and service-role payment lookup remain functional", async () => {
      const tenantId = `payment_grant_probe_${suffix}_crud_tenant`;
      const inserted = await ownerAClient.from("rental_tenants").insert({
        owner_id: ownerA.id, id: tenantId, display_name: "Grant Contract Tenant",
        email: `grant-contract-${suffix}@example.test`, status: "invited",
      }).select("id,status").single();
      expect(inserted.error).toBeNull();
      expect(inserted.data.status).toBe("invited");

      const updated = await ownerAClient.from("rental_tenants").update({ status: "active" })
        .eq("owner_id", ownerA.id).eq("id", tenantId).select("id,status").single();
      expect(updated.error).toBeNull();
      expect(updated.data.status).toBe("active");

      const serviceRead = await admin.from("rental_tenants").select("id,status")
        .eq("owner_id", ownerA.id).eq("id", tenantId).single();
      expect(serviceRead.error).toBeNull();
      expect(serviceRead.data.id).toBe(tenantId);

      const deleted = await ownerAClient.from("rental_tenants").delete()
        .eq("owner_id", ownerA.id).eq("id", tenantId).select("id").single();
      expect(deleted.error).toBeNull();
      expect(deleted.data.id).toBe(tenantId);
    });

      it("service-role can select, insert, and update private_financing_online_payments end to end (real production call shape, minimal fixture chain)", async () => {
        const accountId = `payment_grant_probe_${suffix}_pf_account`;
        const borrowerId = `payment_grant_probe_${suffix}_pf_borrower`;
        const paymentId = `payment_grant_probe_${suffix}_pf_payment`;
        psql(`
          insert into private_financing_borrowers (owner_id, id, email) values ('${ownerA.id}', '${borrowerId}', 'pf-probe-${suffix}@example.test') on conflict do nothing;
          insert into private_financing_accounts (owner_id, id, product, opened_date, origination_principal_cents) values ('${ownerA.id}', '${accountId}', 'personal_loan', '2026-01-01', 500000) on conflict do nothing;
        `);

        const inserted = await admin.from("private_financing_online_payments").insert({
          owner_id: ownerA.id, id: paymentId, account_id: accountId, borrower_id: borrowerId, provider: "stripe",
          provider_mode: "test", amount_cents: 10000, status: "created", idempotency_key: paymentId,
        }).select().single();
        expect(inserted.error).toBeNull();

        const selected = await admin.from("private_financing_online_payments").select("*").eq("owner_id", ownerA.id).eq("id", paymentId).single();
        expect(selected.error).toBeNull();
        expect(selected.data.status).toBe("created");

        const updated = await admin.from("private_financing_online_payments").update({ status: "requires_payment_method", updated_at: new Date().toISOString() })
          .eq("owner_id", ownerA.id).eq("id", paymentId).select().single();
        expect(updated.error).toBeNull();
        expect(updated.data.status).toBe("requires_payment_method");

        // Canary proof: reapplying the migration changes nothing about this exact row.
        const snapshot = () => psql(`select status || '|' || updated_at::text from private_financing_online_payments where owner_id = '${ownerA.id}' and id = '${paymentId}';`);
        const before = snapshot();
        psql(migrationSql);
        const after = snapshot();
        expect(after).toBe(before);
      });

      it("no production path requires service-role delete on any of the four private-financing tables", () => {
        const checks = SHARED_TABLE_NAMES.map((table) => `has_table_privilege('service_role', '${table}', 'DELETE') as ${table}`).join(",\n");
        const output = psql(`select\n${checks};`);
        const values = rows(output)[0];
        expect(values).toEqual(SHARED_TABLE_NAMES.map(() => "f"));
      });

      it("function EXECUTE matrix: the four private-financing SECURITY DEFINER RPCs reject public/anon/authenticated", () => {
        const checks = PRIVATE_FINANCING_FUNCTION_SIGNATURES.map((signature, index) => `
          has_function_privilege('public', '${signature}', 'EXECUTE') as public_${index},
          has_function_privilege('anon', '${signature}', 'EXECUTE') as anon_${index},
          has_function_privilege('authenticated', '${signature}', 'EXECUTE') as auth_${index},
          has_function_privilege('service_role', '${signature}', 'EXECUTE') as svc_${index}
        `).join(",\n");
        const output = psql(`select\n${checks};`);
        const values = rows(output)[0];
        for (let index = 0; index < PRIVATE_FINANCING_FUNCTION_SIGNATURES.length; index += 1) {
          const [publicX, anonX, authX, svcX] = values.slice(index * 4, index * 4 + 4);
          expect([publicX, anonX, authX, svcX], PRIVATE_FINANCING_FUNCTION_SIGNATURES[index]).toEqual(["f", "f", "f", "t"]);
        }
      });

      it("an unrelated authenticated user cannot read another workspace's rental_tenants row (grant and RLS are independent)", async () => {
        const tenantId = `payment_grant_probe_${suffix}_tenant`;
        psql(`insert into rental_tenants (owner_id, id, display_name, email, status) values ('${ownerA.id}', '${tenantId}', 'Probe Tenant', 'probe-tenant-${suffix}@example.test', 'active') on conflict do nothing;`);
        const ownSelect = await ownerAClient.from("rental_tenants").select("id,owner_id").eq("id", tenantId);
        expect(ownSelect.error).toBeNull();
        expect(ownSelect.data).toHaveLength(1);
        const crossSelect = await ownerBClient.from("rental_tenants").select("id,owner_id").eq("id", tenantId);
        expect(crossSelect.error, "cross-workspace select should not privilege-error").toBeNull();
        expect(crossSelect.data, "cross-workspace select must return zero rows under RLS").toEqual([]);
      });

      it("test cleanup for the Bucket-1 additions succeeds without broadening production privileges", () => {
        const probeId = `payment_grant_probe_${suffix}_pf_cleanup_check`;
        psql(`
          insert into private_financing_borrowers (owner_id, id, email) values ('${ownerA.id}', '${probeId}', 'pf-cleanup-${suffix}@example.test') on conflict do nothing;
          delete from private_financing_borrowers where owner_id = '${ownerA.id}' and id = '${probeId}';
        `);
        const remaining = psql(`select count(*)::text from private_financing_borrowers where owner_id = '${ownerA.id}' and id = '${probeId}';`);
        expect(rows(remaining)[0][0]).toBe("0");
        const svcDelete = psql(`select has_table_privilege('service_role', 'private_financing_online_payments', 'DELETE');`);
        expect(rows(svcDelete)[0][0]).toBe("f");
      });
  });
});
