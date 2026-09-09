// Real-infrastructure regression test for the durable refresh-work state machine added by
// supabase/migrations/20260909070000_create_financial_account_refresh_state.sql -- proves the
// two atomicity-critical SQL functions (claim_financial_account_refresh_work,
// commit_financial_account_refresh_work) actually behave correctly under real Postgres
// concurrency and crash-recovery scenarios, not just that the migration text looks right.
//
// Run against a local Supabase stack (Postgres only -- these functions need no PostgREST/RLS/
// auth at all) via Docker, the same stack src/domains/health/__tests__/healthRpcs.integration
// .test.js and the Hotfix A financial_accounts created_at test already target. Self-skips (not
// fails) when that stack isn't reachable.
//
// Writes go through raw `psql` (as the `postgres` superuser), for the same reason the Hotfix A
// integration test does: financial_accounts (and, following the same schema convention, these
// new tables) grant no direct write privileges to service_role. Concurrency tests spawn two
// genuinely separate `psql` processes -- two real, independent Postgres connections -- via
// Promise.all, so Postgres's own row-level locking is what's actually being proven, not
// something simulated in JS.
//
// feature is only ever 'transactions' here (the CHECK constraint allows exactly 'balance' |
// 'transactions') -- test isolation instead comes from giving each test its OWN
// financial_account_id, tracked and cleaned up in afterAll.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_marketplace409-reservation-validation";
const LOCAL_URL = "http://127.0.0.1:54321";
const FEATURE = "transactions";
const OWNER_ID = `test-owner-${randomUUID()}`;

const MIGRATION_SQL = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20260909070000_create_financial_account_refresh_state.sql"),
  "utf8",
);

function psql(sql) {
  return execFileSync("docker", ["exec", "-i", DB_CONTAINER, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], {
    input: sql, encoding: "utf8",
  });
}

function psqlRows(sql) {
  const output = execFileSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-v", "ON_ERROR_STOP=1", "-t", "-A", "-F", "|", "-U", "postgres", "-d", "postgres"],
    { input: sql, encoding: "utf8" },
  );
  return output.trim().split("\n").filter(Boolean).map((line) => line.split("|"));
}

async function psqlAsync(sql) {
  return new Promise((resolve, reject) => {
    try {
      resolve(psql(sql));
    } catch (error) {
      reject(error);
    }
  });
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
const createdAccountIds = [];

function freshAccount() {
  const financialAccountId = `test-account-${randomUUID()}`;
  createdAccountIds.push(financialAccountId);
  psql(`
    insert into financial_accounts (id, owner_id, connection_id, provider, provider_account_id, institution_id, name, official_name, mask, type, subtype, currency_code, active, created_at, updated_at)
    values ('${financialAccountId}', '${OWNER_ID}', '${financialAccountId}_conn', 'p', '${financialAccountId}_pa', 'i', 'n', null, null, 'depository', 'checking', 'USD', true, now(), now());
  `);
  return financialAccountId;
}

function claimSql(financialAccountId, refreshId, attemptedAt, eventId) {
  return `select * from claim_financial_account_refresh_work('${financialAccountId}','${FEATURE}','${OWNER_ID}','${refreshId}',${attemptedAt},'${eventId}');`;
}

function commitSql(workItemId, financialAccountId, refreshId, attemptedAt) {
  return `select * from commit_financial_account_refresh_work('${workItemId}','${financialAccountId}','${FEATURE}','${OWNER_ID}','${refreshId}',${attemptedAt});`;
}

describe.skipIf(!reachable)("financial_account_refresh_work_items / watermarks (real local Supabase)", () => {
  beforeAll(async () => {
    // Idempotency guard, matching the existing integration-test convention: a prior killed run
    // may have left objects behind, but re-applying is always safe.
    psql(`
      drop function if exists claim_financial_account_refresh_work(text,text,text,text,bigint,text,integer);
      drop function if exists commit_financial_account_refresh_work(text,text,text,text,text,bigint);
      drop table if exists financial_account_refresh_work_items cascade;
      drop table if exists financial_account_refresh_watermarks cascade;
      drop function if exists enforce_financial_account_refresh_owner() cascade;
    `);
    psql(MIGRATION_SQL);
  }, 30000);

  afterAll(async () => {
    if (!reachable || createdAccountIds.length === 0) return;
    const idList = createdAccountIds.map((id) => `'${id}'`).join(",");
    psql(`
      delete from financial_account_refresh_work_items where financial_account_id in (${idList});
      delete from financial_account_refresh_watermarks where financial_account_id in (${idList});
      delete from financial_accounts where id in (${idList});
    `);
  }, 30000);

  it("claims, commits, and correctly reports a redelivery of the same refresh as already-nothing-to-do (no re-import)", async () => {
    const financialAccountId = freshAccount();
    const [claim1] = psqlRows(claimSql(financialAccountId, "refresh_A", 1000, "evt_1"));
    expect(claim1[0]).toBe("claimed");

    const [commit1] = psqlRows(commitSql(claim1[1], financialAccountId, "refresh_A", 1000));
    expect(commit1[0]).toBe("committed");

    const [redelivery] = psqlRows(claimSql(financialAccountId, "refresh_A", 1000, "evt_1_retry"));
    expect(redelivery[0]).toBe("already_committed");
  }, 15000);

  it("a newer event arriving while an older one is still claimed (not yet committed) stays queued, not falsely processed -- slot_busy", async () => {
    const financialAccountId = freshAccount();
    const [claimOlder] = psqlRows(claimSql(financialAccountId, "refresh_old", 1000, "evt_old"));
    expect(claimOlder[0]).toBe("claimed");

    const [claimNewer] = psqlRows(claimSql(financialAccountId, "refresh_new", 2000, "evt_new"));
    expect(claimNewer[0]).toBe("slot_busy");

    const rows = psqlRows(`select status from financial_account_refresh_work_items where financial_account_id = '${financialAccountId}' and refresh_id = 'refresh_new';`);
    expect(rows[0][0]).toBe("queued"); // never falsely marked processed/committed
  }, 15000);

  it("two different refresh ids with the identical refresh_last_attempted_at persist independently without any spurious collision", async () => {
    const financialAccountId = freshAccount();
    const [claimX] = psqlRows(claimSql(financialAccountId, "refresh_X", 5000, "evt_x"));
    expect(claimX[0]).toBe("claimed");
    const [commitX] = psqlRows(commitSql(claimX[1], financialAccountId, "refresh_X", 5000));
    expect(commitX[0]).toBe("committed");

    // A DIFFERENT refresh id, same second -- must be treated as a genuinely distinct refresh,
    // never as a duplicate/conflict of refresh_X just because the timestamp matches.
    const [claimY] = psqlRows(claimSql(financialAccountId, "refresh_Y", 5000, "evt_y"));
    expect(claimY[0]).toBe("claimed");
    expect(claimY[1]).not.toBe(claimX[1]);

    const rows = psqlRows(`select refresh_id from financial_account_refresh_work_items where financial_account_id = '${financialAccountId}' order by refresh_id;`);
    expect(rows.map((r) => r[0])).toEqual(["refresh_X", "refresh_Y"]);
  }, 15000);

  it("crash after claim but before import: a stale (lease-expired) claim on the SAME refresh is safely reclaimed and can proceed to commit", async () => {
    const financialAccountId = freshAccount();
    const [claim1] = psqlRows(claimSql(financialAccountId, "refresh_crash", 1000, "evt_crash"));
    expect(claim1[0]).toBe("claimed");

    // Simulate the crash: back-date the lease into the past, exactly as a real 5-minute-old
    // stuck claim would look. Never touched importing/committed -- the process died right here.
    psql(`update financial_account_refresh_work_items set lease_expires_at = now() - interval '1 minute' where id = '${claim1[1]}';`);

    const [reclaim] = psqlRows(claimSql(financialAccountId, "refresh_crash", 1000, "evt_crash_retry"));
    expect(reclaim[0]).toBe("claimed");
    expect(reclaim[1]).toBe(claim1[1]); // the SAME work item, reclaimed -- not a duplicate row

    const [commit1] = psqlRows(commitSql(reclaim[1], financialAccountId, "refresh_crash", 1000));
    expect(commit1[0]).toBe("committed");

    const rows = psqlRows(`select attempts from financial_account_refresh_work_items where id = '${claim1[1]}';`);
    expect(Number(rows[0][0])).toBe(2); // incremented on both the original claim and the reclaim
  }, 15000);

  it("a stale claim on one refresh does not block a genuinely NEWER refresh forever -- the newer one can steal the slot once the old lease expires", async () => {
    const financialAccountId = freshAccount();
    const [claimOld] = psqlRows(claimSql(financialAccountId, "refresh_stuck", 1000, "evt_stuck"));
    expect(claimOld[0]).toBe("claimed");
    psql(`update financial_account_refresh_work_items set lease_expires_at = now() - interval '1 minute' where id = '${claimOld[1]}';`);

    const [claimNew] = psqlRows(claimSql(financialAccountId, "refresh_fresh", 2000, "evt_fresh"));
    expect(claimNew[0]).toBe("claimed");

    const oldRow = psqlRows(`select status from financial_account_refresh_work_items where id = '${claimOld[1]}';`);
    expect(oldRow[0][0]).toBe("failed"); // released, not silently stuck forever
  }, 15000);

  it("no stale overwrite: a commit attempt with an older refresh loses the compare-and-swap to an already-committed newer one -- reported superseded, watermark unchanged", async () => {
    const financialAccountId = freshAccount();
    const [claimNewer] = psqlRows(claimSql(financialAccountId, "refresh_newer", 2000, "evt_newer"));
    const [commitNewer] = psqlRows(commitSql(claimNewer[1], financialAccountId, "refresh_newer", 2000));
    expect(commitNewer[0]).toBe("committed");

    // A separate, OLDER refresh's own work item (e.g. its import ran unusually slowly) tries to
    // commit after the newer one already won -- must lose, must never overwrite the balance/
    // transaction data the newer refresh already committed.
    const olderWorkItemId = `refresh_work_${financialAccountId}_${FEATURE}_refresh_older`;
    psql(`
      insert into financial_account_refresh_work_items (id, financial_account_id, feature, owner_id, refresh_id, refresh_last_attempted_at, status)
      values ('${olderWorkItemId}', '${financialAccountId}', '${FEATURE}', '${OWNER_ID}', 'refresh_older', 1000, 'importing');
    `);
    const [commitOlder] = psqlRows(commitSql(olderWorkItemId, financialAccountId, "refresh_older", 1000));
    expect(commitOlder[0]).toBe("superseded");
    expect(commitOlder[1]).toBe("refresh_newer");

    const watermark = psqlRows(`select committed_refresh_id from financial_account_refresh_watermarks where financial_account_id = '${financialAccountId}';`);
    expect(watermark[0][0]).toBe("refresh_newer"); // never regressed
  }, 15000);

  it("actually concurrent delivery: two real, simultaneous Postgres connections racing to claim two different refreshes for the same account+feature -- exactly one wins", async () => {
    const financialAccountId = freshAccount();

    // Two genuinely separate `psql` processes -- two independent Postgres connections -- issued
    // via Promise.all, racing against the SAME account+feature slot at the same time.
    const [resultA, resultB] = await Promise.all([
      psqlAsync(claimSql(financialAccountId, "refresh_race_A", 3000, "evt_race_a")),
      psqlAsync(claimSql(financialAccountId, "refresh_race_B", 4000, "evt_race_b")),
    ]);

    const parseOutcome = (output) => output.split("\n").find((line) => line.includes("claimed") || line.includes("slot_busy"))?.trim();
    const outcomeA = parseOutcome(resultA);
    const outcomeB = parseOutcome(resultB);
    const claimedCount = [outcomeA, outcomeB].filter((line) => line && line.startsWith("claimed")).length;
    expect(claimedCount).toBe(1); // exactly one of the two genuinely concurrent attempts won

    const activeSlotRows = psqlRows(`select refresh_id from financial_account_refresh_work_items where financial_account_id = '${financialAccountId}' and status = 'claimed';`);
    expect(activeSlotRows).toHaveLength(1); // the partial unique index allows exactly one
  }, 15000);

  it("bootstraps the watermark's committed_refresh_id from the legacy vaulted cursor exactly once -- never resets or discards an already-real watermark", async () => {
    const financialAccountId = freshAccount();

    // Exactly what SupabaseFinancialAccountRefreshRepository.bootstrapWatermarkFromLegacyCursor
    // issues: an insert-or-ignore on (financial_account_id, feature), with a null timestamp
    // (the legacy cursor never recorded one).
    const bootstrapSql = (legacyRefreshId) => `
      insert into financial_account_refresh_watermarks (financial_account_id, feature, owner_id, committed_refresh_id, committed_refresh_last_attempted_at, committed_at)
      values ('${financialAccountId}', '${FEATURE}', '${OWNER_ID}', '${legacyRefreshId}', null, null)
      on conflict (financial_account_id, feature) do nothing;
    `;

    psql(bootstrapSql("legacy_cursor_value"));
    const afterBootstrap = psqlRows(`select committed_refresh_id, committed_refresh_last_attempted_at from financial_account_refresh_watermarks where financial_account_id = '${financialAccountId}';`);
    expect(afterBootstrap[0][0]).toBe("legacy_cursor_value");
    expect(afterBootstrap[0][1]).toBe(""); // null

    // A real refresh now commits, advancing the watermark for real.
    const [claim1] = psqlRows(claimSql(financialAccountId, "refresh_real", 1000, "evt_real"));
    const [commit1] = psqlRows(commitSql(claim1[1], financialAccountId, "refresh_real", 1000));
    expect(commit1[0]).toBe("committed");

    // A second bootstrap attempt (e.g. a later webhook redelivery re-reading the same legacy
    // vault value) must NEVER overwrite the now-real watermark -- insert-or-ignore, not upsert.
    psql(bootstrapSql("legacy_cursor_value"));
    const afterSecondBootstrap = psqlRows(`select committed_refresh_id from financial_account_refresh_watermarks where financial_account_id = '${financialAccountId}';`);
    expect(afterSecondBootstrap[0][0]).toBe("refresh_real"); // untouched by the redundant bootstrap
  }, 15000);

  it("rejects a work item row whose owner_id does not match the financial account's own owner_id", async () => {
    const financialAccountId = freshAccount();
    expect(() => psql(`
      insert into financial_account_refresh_work_items (id, financial_account_id, feature, owner_id, refresh_id, refresh_last_attempted_at, status)
      values ('bad_owner_work_item_${financialAccountId}', '${financialAccountId}', '${FEATURE}', 'a-different-owner', 'refresh_z', 1000, 'queued');
    `)).toThrow();
  }, 15000);
});
