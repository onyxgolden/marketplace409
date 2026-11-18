// End-to-end proof for verdict P1 (PR #831 fix round 1).
//
// The REAL generator script (scripts/external-accounts-status-section.mjs)
// — the path the morning briefing and every FORGE status report runs —
// is executed as a subprocess against a REAL PostgreSQL 16 fixture
// cluster (the shipped migration applied, seed-derived rows inserted),
// through a psql transport speaking the same sb-sql CLI contract
// (--project-ref <ref> --query <sql>, JSON array on stdout).
// It must print the "External accounts and dependent work" section
// with Property Risk Radar as open/not built, with register + tracker
// provenance — and never leak an account email or credential locator.
//
// Also proved here: the unavailable path (tables not yet created —
// the live state while migration 20261117140000 is on HOLD) prints a
// prominent WARNING and exits 0 instead of silently reporting zero
// accounts; and a live-but-empty register says so explicitly.
//
// Real PG16 only (PGlite cannot serve a subprocess transport).
// Skipped where no PG16 initdb exists.

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execSync, execFileSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import {
  buildSeedCandidates,
  buildSeedThreads,
} from "../../src/domains/externalAccounts/externalAccountSeed.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts/external-accounts-status-section.mjs");
const MIGDIR = join(REPO_ROOT, "supabase/migrations");
const DROP_DIR = join(process.env.HOME ?? "~", "workspace/forge-ai-drop");

// The real household identities: the script defaults its scoping to
// Jason's platform owner id, so the fixture must use it too.
const OWNER_ID = "e1b22131-9100-4a79-bbe2-b82d43af922e";
const BRANDY_ID = "29017817-2edd-42ee-bb0a-f10bc28e0d26";

const PG_BIN = "/usr/lib/postgresql/16/bin";
const PG_RUN_USER = "postgres";
const PG_PORT = 55439;
const HAS_REAL_PG = (() => {
  try {
    execSync(`test -x "${PG_BIN}/initdb"`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
})();
const it60 = (name, fn) => it(name, fn, 60000);

// Same prerequisite setup as the migration proof: roles + auth shim,
// the two workspace-membership migrations, the register migration,
// and the membership rows the household gate reads.
//
// Roles are cluster-global (created once); the auth schema, users
// table and migrations are per-database.
const CLUSTER_ROLES_SQL = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
`;
const PREREQ_SQL = `
  create schema auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select current_setting('app.test_uid', true)::uuid
  $$;
  create table auth.users (id uuid primary key, email text, created_at timestamptz default now());
  insert into auth.users (id, email) values
    ('${OWNER_ID}', 'jason@example.test'),
    ('${BRANDY_ID}', 'brandy@example.test')
    on conflict do nothing;
`;
const SEED_SQL = `
  insert into workspace_members (owner_id, id, member_user_id, role, status, invited_email, invited_by, invited_at, activated_at, suspended_at)
    values ('${OWNER_ID}', 'wm-brandy', '${BRANDY_ID}', 'co_owner', 'active', 'brandy@example.test', '${OWNER_ID}', now(), now(), null)
    on conflict do nothing;
`;

function loadMigrationSql(name) {
  return readFileSync(join(MIGDIR, name), "utf8");
}

async function applyRegisterSchema(client) {
  await client.query(PREREQ_SQL);
  await client.query(loadMigrationSql("20260829000000_create_workspace_members.sql"));
  await client.query(
    loadMigrationSql("20260829000100_add_workspace_authorization_helpers.sql"),
  );
  await client.query(
    loadMigrationSql("20261117140000_forge_external_accounts_register.sql"),
  );
}

function esc(value) {
  return value == null ? "NULL" : `'${String(value).replace(/'/g, "''")}'`;
}

describe.skipIf(!HAS_REAL_PG)("external accounts status section: real generator end-to-end", () => {
  let pgDir;
  let pgClient;
  let wrapperPath;
  let dropHead;

  beforeAll(async () => {
    dropHead = execSync("git rev-parse HEAD", { cwd: DROP_DIR, encoding: "utf8" }).trim();
    pgDir = mkdtempSync(join(tmpdir(), "ear-gen-"));
    execSync(`chown ${PG_RUN_USER}:${PG_RUN_USER} "${pgDir}"`, { stdio: "pipe" });
    const asPgUser = (cmd) => `runuser -u ${PG_RUN_USER} -- ${cmd}`;
    execSync(
      asPgUser(
        `"${PG_BIN}/initdb" -D "${pgDir}" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8`,
      ),
      { stdio: "pipe" },
    );
    execSync(
      asPgUser(
        `"${PG_BIN}/pg_ctl" -D "${pgDir}" -o "-p ${PG_PORT} -k ${pgDir} -c listen_addresses=''" -l "${pgDir}/server.log" start`,
      ),
      { stdio: "pipe" },
    );
    pgClient = new Client({ host: pgDir, port: PG_PORT, user: "postgres", database: "postgres" });
    await pgClient.connect();
    await pgClient.query(CLUSTER_ROLES_SQL);
    await applyRegisterSchema(pgClient);
    await pgClient.query(SEED_SQL);
    await pgClient.query("create database ear_empty");
    await pgClient.query("create database ear_norows");
    const emptyClient = new Client({
      host: pgDir,
      port: PG_PORT,
      user: "postgres",
      database: "ear_norows",
    });
    await emptyClient.connect();
    await applyRegisterSchema(emptyClient);
    await emptyClient.end();

    // Fixture rows: the 10 real Radar prospective sources from the
    // seed, plus a confirmed account, a blocked setup, and a stale
    // entry — with a real-looking email + locator on one row to prove
    // the generator never leaks them.
    const candidates = buildSeedCandidates();
    const radar = candidates.filter((c) => c.work_thread_label === "Property Risk Radar");
    const github = candidates.find((c) => c.provider_slug === "github");
    const resend = candidates.find((c) => c.provider_slug === "resend");
    const namecheap = candidates.find((c) => c.provider_slug === "namecheap");
    const googleCloud = candidates.find((c) => c.provider_slug === "google-cloud");
    const accountIds = new Map();
    async function insertAccount(candidate, overrides = {}) {
      const row = { ...candidate, ...overrides };
      const { rows } = await pgClient.query(
        `insert into forge_external_accounts
           (platform_owner_id, seed_key, provider_name, purpose, associated_app,
            work_thread_label, account_email, plan_status, billing_arrangement,
            api_integration_status, still_needed, credential_location,
            record_status, setup_status, source_kind, source_reference, notes,
            created_by, updated_by, last_verified_at)
         values (${esc(OWNER_ID)}, ${esc(row.seed_key)}, ${esc(row.provider_name)},
           ${esc(row.purpose)}, ${esc(row.associated_app)}, ${esc(row.work_thread_label)},
           ${esc(row.account_email)}, ${esc(row.plan_status)}, ${esc(row.billing_arrangement)},
           ${esc(row.api_integration_status)}, ${row.still_needed == null ? "NULL" : row.still_needed},
           ${esc(row.credential_location)}, ${esc(row.record_status)}, ${esc(row.setup_status)},
           ${esc(row.source_kind)}, ${esc(row.source_reference)}, ${esc(row.notes)},
           ${esc(OWNER_ID)}::uuid, ${esc(OWNER_ID)}::uuid, ${esc(row.last_verified_at)})
         returning id`,
      );
      accountIds.set(row.seed_key, rows[0].id);
      return rows[0].id;
    }
    for (const source of radar) await insertAccount(source);
    await insertAccount(github);
    await insertAccount(googleCloud, { setup_status: "blocked", last_verified_at: null });
    await insertAccount(resend, {
      account_email: "jasonmorgan99@gmail.com",
      credential_location: "1Password → FORGE",
      setup_status: "in_progress",
      last_verified_at: null,
    });
    await insertAccount(namecheap, { setup_status: "blocked", last_verified_at: null });
    await insertAccount(
      {
        seed_key: "external_accounts_seed_v1:stale-co",
        provider_name: "Stale Co",
        purpose: "Old integration",
        associated_app: "FORGE",
        work_thread_label: null,
        account_email: null,
        plan_status: "unknown",
        billing_arrangement: null,
        api_integration_status: "unknown",
        still_needed: true,
        credential_location: null,
        record_status: "confirmed_account",
        setup_status: "ready",
        source_kind: "manual",
        source_reference: null,
        notes: null,
      },
      { last_verified_at: "2026-08-01T00:00:00Z" },
    );
    const threads = buildSeedThreads();
    const radarThreads = threads.filter((t) => t.title.startsWith("Property Risk Radar"));
    const googleCloudThread = threads.find((t) => t.title.startsWith("Google Cloud"));
    for (const thread of [...radarThreads, googleCloudThread]) {
      const accountId = accountIds.get(thread.account_seed_key);
      await pgClient.query(
        `insert into forge_external_account_threads
           (account_id, platform_owner_id, title, reference, state, next_action, owner, next_review_on)
         values (${esc(accountId)}::uuid, ${esc(OWNER_ID)}, ${esc(thread.title)},
           ${esc(thread.reference)}, ${esc(thread.state)}, ${esc(thread.next_action)},
           ${esc(thread.owner)}, ${esc(thread.next_review_on)})`,
      );
    }

    // psql transport speaking the sb-sql CLI contract.
    wrapperPath = join(pgDir, "wrap-sql.sh");
    writeFileSync(
      wrapperPath,
      `#!/bin/sh
# Test transport: --project-ref <ref> --query <sql> -> JSON array on stdout.
query=""
prev=""
for a in "$@"; do
  if [ "$prev" = "--query" ]; then query="$a"; fi
  prev="$a"
done
db="\${EAR_PG_DATABASE:-postgres}"
exec psql -h "${pgDir}" -p ${PG_PORT} -U postgres -d "$db" -v ON_ERROR_STOP=1 -t -A \\
  -c "SELECT COALESCE(json_agg(t),'[]'::json)::text FROM ($query) t"
`,
    );
    chmodSync(wrapperPath, 0o755);
  }, 180000);

  afterAll(async () => {
    try {
      await pgClient?.end();
    } catch {
      /* already closed */
    }
    if (pgDir) {
      try {
        execSync(
          `runuser -u ${PG_RUN_USER} -- "${PG_BIN}/pg_ctl" -D "${pgDir}" stop -m fast`,
          { stdio: "pipe" },
        );
      } catch {
        /* already stopped */
      }
      rmSync(pgDir, { recursive: true, force: true });
    }
  }, 120000);

  function runGenerator({ json = false, database = "postgres" } = {}) {
    return execFileSync(
      "node",
      [SCRIPT, ...(json ? ["--json"] : [])],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: 60000,
        env: {
          ...process.env,
          EXTERNAL_ACCOUNTS_SQL_CMD: wrapperPath,
          FORGE_AI_DROP_DIR: DROP_DIR,
          EAR_PG_DATABASE: database,
        },
      },
    );
  }

  it60("the real generator surfaces Radar as open/not built, with provenance, no leaks", () => {
    const out = runGenerator({ json: true });
    const { section, provenance } = JSON.parse(out);
    expect(section.section).toBe("external_accounts");
    expect(section.radar.status).toBe("open_not_built");
    expect(section.radar.prospective_source_count).toBe(10);
    expect(section.radar.open_thread_count).toBe(2);
    expect(section.radar.open_threads[0].title).toContain("Property Risk Radar");
    expect(section.counts.total).toBe(15);
    expect(section.counts.setup_blocked).toBe(2);
    expect(section.counts.stale).toBeGreaterThanOrEqual(1);
    expect(section.stale_entries.map((e) => e.provider)).toContain("Stale Co");
    expect(section.follow_ups.find((f) => f.provider === "Namecheap")).toMatchObject({
      priority: 1,
      kind: "setup_blocked",
    });
    // Provenance: real tracker revision, real query time.
    expect(provenance.tracker_revision).toBe(dropHead);
    expect(Number.isNaN(Date.parse(provenance.queried_at))).toBe(false);
    // No account email or credential locator anywhere in the output.
    expect(out).not.toContain("jasonmorgan99@gmail.com");
    expect(out).not.toContain("1Password");
    expect(out).not.toContain("credential_location");
    expect(out).not.toContain("account_email");
  });

  it60("text mode carries the section verbatim for the briefing", () => {
    const out = runGenerator();
    expect(out).toContain("External accounts and dependent work");
    expect(out).toContain("Property Risk Radar: open / not built");
    expect(out).toContain(`Provenance: register queried `);
    expect(out).toContain(`tracker revision ${dropHead.slice(0, 7)}`);
    expect(out).toContain("[setup_blocked] Namecheap");
    expect(out).not.toContain("jasonmorgan99@gmail.com");
    expect(out).not.toContain("1Password");
    // Evidence artifact for the re-review: the generated report
    // itself, from the real generator run (ignored, not committed).
    const evidenceDir = join(
      REPO_ROOT,
      ".test-data-evidence/external-accounts-register/fixround1",
    );
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(join(evidenceDir, "generated-status-report.txt"), out);
    writeFileSync(
      join(evidenceDir, "generated-status-report.json"),
      runGenerator({ json: true }),
    );
  });

  it60("unavailable register warns and exits 0 — never a silent zero", () => {
    // ear_empty has no tables at all: the live state while migration
    // 20261117140000 is on HOLD.
    const out = runGenerator({ database: "ear_empty" });
    expect(out).toContain("WARNING");
    expect(out).toContain("unavailable");
    expect(out).toContain("Do not treat this report as showing zero accounts");
    expect(out).not.toContain("accounts tracked");
  });

  it60("live-but-empty register says so explicitly", () => {
    const out = runGenerator({ database: "ear_norows" });
    expect(out).toContain("The register is empty");
    expect(out).toContain("not a statement that there are no external dependencies");
    expect(out).toContain("Property Risk Radar: not seeded");
  });
});
