// Migration contract test for 20261012000000_scheduled_send_ledger.sql,
// executed against an in-process Postgres (PGlite). Verifies the table
// shape, the idempotency key, the state check constraint, RLS enablement,
// and that the migration is re-runnable. No linked/remote database touched.
//
// The migration is PREPARED for review only; applying it to production
// Supabase is Jason's separate explicit authorization.

import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const MIGRATION_PATH = new URL("../20261012000000_scheduled_send_ledger.sql", import.meta.url);
const migrationSql = readFileSync(MIGRATION_PATH, "utf8");

let db;

beforeAll(async () => {
  db = new PGlite();
  // PGlite ships without pgcrypto: stub gen_random_uuid() so the migration's
  // column default resolves. The default value itself is not under test.
  await db.exec(
    `create or replace function gen_random_uuid() returns uuid language sql as
     $$ select '00000000-0000-0000-0000-000000000000'::uuid $$;`,
  );
  await db.exec(migrationSql);
  // Re-runnable: second apply must not error.
  await db.exec(migrationSql);
});

describe("scheduled_send_ledger migration", () => {
  it("creates the table with the expected columns", async () => {
    const { rows } = await db.query(
      `select column_name, data_type from information_schema.columns
       where table_name = 'scheduled_send_ledger' order by column_name`,
    );
    const names = rows.map((r) => r.column_name);
    for (const col of [
      "id",
      "schedule_name",
      "scheduled_slot",
      "recipient_allowlist_id",
      "run_id",
      "state",
      "provider_message_id",
      "failure_reason",
      "send_attempts",
      "claimed_at",
      "updated_at",
      "created_at",
    ]) {
      expect(names).toContain(col);
    }
  });

  it("creates the scheduled_send_attempts child table (RDL-004)", async () => {
    const { rows } = await db.query(
      `select column_name from information_schema.columns
       where table_name = 'scheduled_send_attempts' order by column_name`,
    );
    const names = rows.map((r) => r.column_name);
    for (const col of [
      "id",
      "ledger_id",
      "delivery_id",
      "state",
      "provider_message_id",
      "failure_reason",
      "run_id",
      "attempted_at",
    ]) {
      expect(names).toContain(col);
    }
    // Attempt states are provider outcomes only.
    await expect(
      db.query(
        `insert into scheduled_send_attempts (ledger_id, delivery_id, state)
         values ('00000000-0000-0000-0000-000000000000', 'del_1', 'claimed')`,
      ),
    ).rejects.toThrow(/check constraint|violates/i);
    // FK to the ledger row.
    await expect(
      db.query(
        `insert into scheduled_send_attempts (ledger_id, delivery_id, state)
         values ('11111111-1111-1111-1111-111111111111', 'del_1', 'provider_accepted')`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);
    const { rows: rel } = await db.query(
      `select relrowsecurity from pg_class where relname = 'scheduled_send_attempts'`,
    );
    expect(rel[0].relrowsecurity).toBe(true);
  });

  it("enforces one row per (schedule_name, scheduled_slot, recipient_allowlist_id)", async () => {
    await db.query(
      `insert into scheduled_send_ledger (schedule_name, scheduled_slot, recipient_allowlist_id, state)
       values ('tenant_invite', '2026-10-12', 'tenant_1', 'claimed')`,
    );
    await expect(
      db.query(
        `insert into scheduled_send_ledger (schedule_name, scheduled_slot, recipient_allowlist_id, state)
         values ('tenant_invite', '2026-10-12', 'tenant_1', 'claimed')`,
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
    // Same recipient, different slot: allowed.
    await db.query(
      `insert into scheduled_send_ledger (schedule_name, scheduled_slot, recipient_allowlist_id, state)
       values ('tenant_invite', '2026-10-13', 'tenant_1', 'claimed')`,
    );
    // Same slot, different schedule: allowed.
    await db.query(
      `insert into scheduled_send_ledger (schedule_name, scheduled_slot, recipient_allowlist_id, state)
       values ('pf_payment_receipts', '2026-10-12', 'tenant_1', 'claimed')`,
    );
  });

  it("rejects unknown schedule_name and state values", async () => {
    await expect(
      db.query(
        `insert into scheduled_send_ledger (schedule_name, scheduled_slot, recipient_allowlist_id, state)
         values ('nope', '2026-10-12', 'tenant_2', 'claimed')`,
      ),
    ).rejects.toThrow(/check constraint|violates/i);
    await expect(
      db.query(
        `insert into scheduled_send_ledger (schedule_name, scheduled_slot, recipient_allowlist_id, state)
         values ('tenant_invite', '2026-10-12', 'tenant_2', 'sent')`,
      ),
    ).rejects.toThrow(/check constraint|violates/i);
  });

  it("rejects malformed scheduled_slot values", async () => {
    await expect(
      db.query(
        `insert into scheduled_send_ledger (schedule_name, scheduled_slot, recipient_allowlist_id, state)
         values ('tenant_invite', '12-10-2026', 'tenant_3', 'claimed')`,
      ),
    ).rejects.toThrow(/check constraint|violates/i);
  });

  it("defaults state to claimed and timestamps to now()", async () => {
    const { rows } = await db.query(
      `insert into scheduled_send_ledger (schedule_name, scheduled_slot, recipient_allowlist_id)
       values ('tenant_payment_receipts', '2026-10-12', 'tenant_9')
       returning state, claimed_at, updated_at, created_at`,
    );
    expect(rows[0].state).toBe("claimed");
    expect(rows[0].claimed_at).toBeTruthy();
    expect(rows[0].updated_at).toBeTruthy();
    expect(rows[0].created_at).toBeTruthy();
  });

  it("has RLS enabled", async () => {
    const { rows } = await db.query(
      `select relrowsecurity from pg_class where relname = 'scheduled_send_ledger'`,
    );
    expect(rows[0].relrowsecurity).toBe(true);
  });
});
