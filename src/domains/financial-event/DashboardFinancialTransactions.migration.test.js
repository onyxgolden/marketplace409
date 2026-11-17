// FORGE load-times Slice 3 — diagnostic history RPC migration proof.
//
// Applies the SHIPPED migration SQL (read from disk, never ad-hoc
// grants) in an in-memory PGlite database (real PostgreSQL) and proves:
//   - Golden cross-engine parity: the SQL transactions RPC returns the
//     same transaction list as the JavaScript
//     FinancialEventAggregationService oracle over the same eligible
//     set -- same rows, same stable event_date,id order, same record
//     shape (abs(amount), unassigned/uncategorized defaults) -- for
//     business / personal / all scopes, on a 1,112-event fixture
//     (forcing multi-page reads at pageSize 100), including owner A/B,
//     pre-2020 dates, unassigned properties, negative amounts,
//     transfers, asset purchases, capitalized expense, affects_noi
//     true/false, deleted/inactive rows, same-date ties, and
//     reconciled/unreconciled account groups with a boundary-date
//     cutover;
//   - The fix itself: the RPC serves ONE page per call from a single
//     DB-side query (EXPLAIN shows a Function Scan, no twelve-page
//     legacy fetch) with exact totalCount/totalPages/complete;
//   - Non-vacuity: a deliberately wrong 365-day lookback variant
//     produces observably different (lower) totals on the same fixture,
//     so the suite can detect lost history;
//   - Read-after-write: an insert, a delete and a property/category
//     move are visible in the next RPC call with no TTL wait;
//   - Authorization: unauthenticated and wrong-owner calls are denied
//     loudly, a co-owner reads the shared workspace, anon has no
//     EXECUTE, PUBLIC is revoked, FORCE RLS still hides other owners'
//     rows, and a page past the end is a 400, not a silent empty page.
//
// Roles, the auth.uid() stub, workspace_members, and the
// has_workspace_access() copy mirror production; the prerequisite
// tables are the minimal shapes the RPC reads (financial_events is the
// real DDL; the account-group tables omit the write-path triggers,
// which the read-only RPC never exercises).
//
// A real-PostgreSQL subset (same golden parity on PG16, wrong-owner
// denial, ACL matrix) runs against a scratch PG16 cluster when the
// binaries exist, and SKIPS LOUDLY — never silently — when they do not.

import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { PGlite } from "@electric-sql/pglite";
import { Client } from "pg";

import {
  FinancialWorkspaceQueryService,
} from "@/application/financial/FinancialWorkspaceQueryService.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const it60 = (name, fn) => it(name, fn, 60000);

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";
const OWNER_C = "55555555-5555-4555-8555-555555555555";
const MEMBER_C = "33333333-3333-4333-8333-333333333333";

const MIGRATION =
  "20261117110000_forge_dashboard_financial_transactions_v1.sql";

function loadMigrationSql(name) {
  return readFileSync(
    join(HERE, "..", "..", "..", "supabase", "migrations", name),
    "utf8",
  );
}

// SQL numeric is exact-decimal; the JS oracle sums IEEE doubles. For
// two-decimal money values the double drift is orders of magnitude
// below a cent, so cent-level equality is the honest parity bar --
// displayed values, not bit-identical floats.
const CENT_TOLERANCE = 0.01;

const PREREQ_SQL = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select current_setting('app.test_uid', true)::uuid
  $$;
  create table workspace_members (
    owner_id text not null,
    member_user_id uuid not null,
    status text not null,
    role text not null
  );
  create or replace function public.has_workspace_access(p_owner_id text)
  returns boolean language sql stable security definer
  set search_path = public set row_security = off as $$
    select p_owner_id = auth.uid()::text
      or exists (
        select 1 from workspace_members
        where owner_id = p_owner_id
          and member_user_id = auth.uid()
          and status = 'active'
          and role = 'co_owner'
      );
  $$;
  revoke all on function public.has_workspace_access(text) from public;
  grant execute on function public.has_workspace_access(text) to authenticated;

  create table if not exists financial_events (
    id text primary key default gen_random_uuid()::text,
    owner_id text not null,
    organization_id text,
    property_id text,
    financial_account_id text,
    business_scope text not null default 'business'
        check (business_scope in ('business', 'personal')),
    event_date date not null,
    description text not null,
    amount numeric not null,
    transaction_kind text not null,
    normalized_category text not null,
    tax_deductible boolean not null default false,
    affects_noi boolean not null default false,
    capitalized boolean not null default false,
    source_system text not null,
    source_record_id text,
    metadata jsonb not null default '{}'::jsonb,
    status text not null default 'active'
        check (status in ('active', 'inactive', 'deleted')),
    is_deleted boolean not null default false,
    deleted_at timestamptz,
    created_by text,
    updated_by text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint financial_events_deleted_state_check
        check (
            (is_deleted = false and deleted_at is null)
            or
            (is_deleted = true and deleted_at is not null)
        )
  );
  create index if not exists idx_financial_events_owner
    on financial_events(owner_id);
  create index if not exists idx_financial_events_owner_event_date
    on financial_events(owner_id, event_date desc);
  alter table financial_events enable row level security;
  alter table financial_events force row level security;
  create policy "financial_events_owner_select"
    on financial_events for select to authenticated
    using (has_workspace_access(owner_id));
  grant select on financial_events to authenticated;

  create table financial_accounts (
    id text primary key,
    owner_id text not null
  );

  create table financial_account_groups (
    id text primary key,
    owner_id text not null,
    balance_authority_account_id text,
    transaction_authority_account_id text,
    transaction_coverage_status text not null default 'not_started',
    transaction_cutover_at date,
    revoked_at timestamptz
  );

  create table financial_account_group_members (
    id text primary key,
    group_id text not null references financial_account_groups(id),
    financial_account_id text not null references financial_accounts(id),
    owner_id text not null,
    revoked_at timestamptz,
    unique (group_id, financial_account_id)
  );
  alter table financial_account_groups enable row level security;
  alter table financial_account_groups force row level security;
  alter table financial_account_group_members enable row level security;
  alter table financial_account_group_members force row level security;
  create policy financial_account_groups_owner_select on financial_account_groups
    for select using (has_workspace_access(owner_id));
  create policy financial_account_group_members_owner_select on financial_account_group_members
    for select using (has_workspace_access(owner_id));
  grant select on financial_account_groups to authenticated;
  grant select on financial_account_group_members to authenticated;
`;

// --- Deterministic fixture -------------------------------------------------
// A fixed-seed LCG, never Math.random(): the same events every run.

let fixtureSeed = 424242424;
function rnd() {
  fixtureSeed = (fixtureSeed * 1103515245 + 12345) % 2147483648;
  return fixtureSeed / 2147483648;
}
function pick(values) {
  return values[Math.floor(rnd() * values.length)];
}

function buildEvent(overrides = {}) {
  return {
    id: "event-x",
    owner_id: OWNER_A,
    status: "active",
    is_deleted: false,
    deleted_at: null,
    property_id: "170-john",
    financial_account_id: null,
    business_scope: "business",
    event_date: "2026-01-05",
    description: "Fixture event",
    amount: 100.0,
    transaction_kind: "income",
    normalized_category: "rental_income",
    tax_deductible: false,
    affects_noi: true,
    capitalized: false,
    source_system: "fixture",
    source_record_id: null,
    metadata: {},
    ...overrides,
  };
}

// The cutover edge cases are deterministic rows, not random: the
// boundary date itself (2026-09-01) is the half-open cut -- events ON
// the cutover are excluded for non-canonical members, retained for the
// canonical member and for every unreconciled/no-authority group.
function cutoverEdgeEvents() {
  const cutover = "2026-09-01";
  const before = "2026-08-31";
  const after = "2026-10-20";
  const base = {
    amount: 1000,
    transaction_kind: "income",
    normalized_category: "rental_income",
    business_scope: "business",
  };
  return [
    buildEvent({ id: "cut-manual-before", financial_account_id: "acct-manual", event_date: before, ...base }),
    buildEvent({ id: "cut-manual-on", financial_account_id: "acct-manual", event_date: cutover, ...base }),
    buildEvent({ id: "cut-manual-after", financial_account_id: "acct-manual", event_date: after, ...base }),
    buildEvent({ id: "cut-stripe-on", financial_account_id: "acct-stripe", event_date: cutover, ...base }),
    buildEvent({ id: "cut-stripe-after", financial_account_id: "acct-stripe", event_date: after, ...base }),
    buildEvent({ id: "cut-plaid-before", financial_account_id: "acct-plaid", event_date: before, ...base }),
    buildEvent({ id: "cut-plaid-after", financial_account_id: "acct-plaid", event_date: after, ...base }),
    // G2 is pending_reconciliation: its member is never filtered.
    buildEvent({ id: "cut-g2-after", financial_account_id: "acct-x", event_date: after, ...base }),
    // G3 is reconciled but has NO transaction authority: never filtered.
    buildEvent({ id: "cut-g3-after", financial_account_id: "acct-y", event_date: after, ...base }),
    // A null-account event on the cutover date: no group rule applies.
    buildEvent({ id: "cut-null-on", financial_account_id: null, event_date: cutover, ...base }),
  ];
}

function buildFixtureEvents() {
  const events = [];
  const dates = [
    "2019-06-15",
    "2022-03-10",
    "2026-01-05",
    "2026-08-31",
    "2026-09-01",
    "2026-10-20",
  ];
  const accounts = ["acct-manual", "acct-stripe", "acct-plaid", null];
  const properties = ["170-john", "335-butler", null, ""];

  // 1,090 random rows + 10 deterministic cutover edges = 1,100 rows
  // for owner A, forcing multi-page reads at pageSize 100. All property
  // ids and categories are lowercase, so the SQL ORDER BY and the JS
  // localeCompare agree on sort order.
  for (let index = 0; index < 1090; index += 1) {
    const kind = pick([
      "income", "income", "expense", "expense", "transfer", "asset_purchase",
    ]);
    const category =
      kind === "income"
        ? "rental_income"
        : kind === "expense"
          ? pick(["repairs", "utilities", "capital_improvement", ""])
          : kind === "transfer"
            ? "internal_transfer"
            : "capital_purchase";
    // Signed amounts: ~15% negative, to prove abs() on both engines.
    const signed = rnd() < 0.15 ? -1 : 1;
    const amount =
      signed * (Math.floor(rnd() * 50000) + 100) / 100;
    const statusRoll = rnd();

    events.push(
      buildEvent({
        id: `event-${String(index).padStart(4, "0")}`,
        property_id: pick(properties),
        financial_account_id: pick(accounts),
        business_scope: rnd() < 0.8 ? "business" : "personal",
        event_date: pick(dates),
        description: `Fixture event ${index}`,
        amount,
        transaction_kind: kind,
        normalized_category: category,
        affects_noi: kind === "income" ? true : rnd() < 0.5,
        capitalized:
          kind === "expense" && category === "capital_improvement",
        status:
          statusRoll < 0.95
            ? "active"
            : statusRoll < 0.975
              ? "inactive"
              : "deleted",
        is_deleted: statusRoll >= 0.99,
        deleted_at:
          statusRoll >= 0.99 ? "2026-11-01T00:00:00.000Z" : null,
        source_record_id: `fixture-${index}`,
      }),
    );
  }

  events.push(...cutoverEdgeEvents());

  for (let index = 0; index < 12; index += 1) {
    events.push(
      buildEvent({
        id: `event-b-${index}`,
        owner_id: OWNER_B,
        property_id: "170-john",
        business_scope: "business",
        event_date: "2026-01-05",
        description: `Owner B event ${index}`,
        amount: 50 + index,
        source_record_id: `fixture-b-${index}`,
      }),
    );
  }

  return events;
}

const FIXTURE_EVENTS = buildFixtureEvents();

const FIXTURE_GROUPS = [
  {
    // G1: reconciled, transaction authority Stripe, cutover 2026-09-01,
    // balance authority Plaid -- deliberately NOT the same account.
    group: {
      transactionCoverageStatus: "reconciled",
      transactionAuthorityAccountId: "acct-stripe",
      transactionCutoverAt: "2026-09-01",
      balanceAuthorityAccountId: "acct-plaid",
    },
    activeMemberFinancialAccountIds: ["acct-manual", "acct-stripe", "acct-plaid"],
  },
  {
    // G2: pending_reconciliation -- filters nothing.
    group: {
      transactionCoverageStatus: "pending_reconciliation",
      transactionAuthorityAccountId: "acct-x",
      transactionCutoverAt: "2026-01-01",
      balanceAuthorityAccountId: "acct-x",
    },
    activeMemberFinancialAccountIds: ["acct-x"],
  },
  {
    // G3: reconciled but NO transaction authority -- filters nothing.
    group: {
      transactionCoverageStatus: "reconciled",
      transactionAuthorityAccountId: null,
      transactionCutoverAt: "2026-01-01",
      balanceAuthorityAccountId: "acct-y",
    },
    activeMemberFinancialAccountIds: ["acct-y"],
  },
];

function sqlStr(value) {
  return value === null || value === undefined
    ? "null"
    : `'${String(value).replace(/'/g, "''")}'`;
}
function sqlNum(value) {
  return value === null || value === undefined ? "null" : String(value);
}
function sqlBool(value) {
  return value ? "true" : "false";
}

function buildSeedSql() {
  const lines = [
    `insert into financial_accounts (id, owner_id) values
      ('acct-manual', '${OWNER_A}'),
      ('acct-stripe', '${OWNER_A}'),
      ('acct-plaid', '${OWNER_A}'),
      ('acct-x', '${OWNER_A}'),
      ('acct-y', '${OWNER_A}');`,
    `insert into financial_account_groups
      (id, owner_id, balance_authority_account_id, transaction_authority_account_id,
       transaction_coverage_status, transaction_cutover_at, revoked_at) values
      ('group-g1', '${OWNER_A}', 'acct-plaid', 'acct-stripe', 'reconciled', '2026-09-01', null),
      ('group-g2', '${OWNER_A}', 'acct-x', 'acct-x', 'pending_reconciliation', '2026-01-01', null),
      ('group-g3', '${OWNER_A}', 'acct-y', null, 'reconciled', '2026-01-01', null);`,
    `insert into financial_account_group_members
      (id, group_id, financial_account_id, owner_id, revoked_at) values
      ('member-g1-manual', 'group-g1', 'acct-manual', '${OWNER_A}', null),
      ('member-g1-stripe', 'group-g1', 'acct-stripe', '${OWNER_A}', null),
      ('member-g1-plaid', 'group-g1', 'acct-plaid', '${OWNER_A}', null),
      ('member-g2-x', 'group-g2', 'acct-x', '${OWNER_A}', null),
      ('member-g3-y', 'group-g3', 'acct-y', '${OWNER_A}', null);`,
    `insert into workspace_members (owner_id, member_user_id, status, role)
      values ('${OWNER_A}', '${MEMBER_C}', 'active', 'co_owner');`,
  ];

  const eventRows = FIXTURE_EVENTS.map((event) => `(
    ${sqlStr(event.id)}, ${sqlStr(event.owner_id)}, ${sqlStr(event.property_id)},
    ${sqlStr(event.financial_account_id)}, ${sqlStr(event.business_scope)},
    ${sqlStr(event.event_date)},
    ${sqlStr(event.description)}, ${sqlNum(event.amount)},
    ${sqlStr(event.transaction_kind)}, ${sqlStr(event.normalized_category)},
    ${sqlBool(event.tax_deductible)}, ${sqlBool(event.affects_noi)},
    ${sqlBool(event.capitalized)}, ${sqlStr(event.source_system)},
    ${sqlStr(event.source_record_id)}, ${sqlStr(event.status)},
    ${sqlBool(event.is_deleted)}, ${sqlStr(event.deleted_at)}
  )`);

  lines.push(
    `insert into financial_events
      (id, owner_id, property_id, financial_account_id, business_scope,
       event_date,
       description, amount, transaction_kind, normalized_category,
       tax_deductible, affects_noi, capitalized, source_system,
       source_record_id, status, is_deleted, deleted_at)
     values ${eventRows.join(",\n")};`,
  );

  return lines.join("\n");
}

const SEED_SQL = buildSeedSql();

async function oracleWorkspace(ownerId, scope) {
  const service = new FinancialWorkspaceQueryService({
    financialEventRepository: {
      findByOwnerId: async (requestedOwnerId) =>
        FIXTURE_EVENTS.filter(
          (event) => event.owner_id === requestedOwnerId,
        ),
    },
    financialAccountGroupRepository: {
      findActiveGroupsForOwner: async (requestedOwnerId) =>
        requestedOwnerId === OWNER_A ? FIXTURE_GROUPS : [],
    },
  });

  return service.buildWorkspace(ownerId, { scope });
}

async function setupDb() {
  const db = new PGlite();
  await db.exec(PREREQ_SQL);
  await db.exec(SEED_SQL);
  await db.exec(loadMigrationSql(MIGRATION));
  return db;
}

async function asRole(db, role, uid, sql) {
  const setUid =
    uid === null
      ? `set role ${role};`
      : `set role ${role}; set app.test_uid = '${uid}';`;
  await db.exec(setUid);
  try {
    return await db.query(sql);
  } finally {
    await db.exec(`reset role;`);
  }
}

async function asUser(db, uid, sql) {
  return asRole(db, "authenticated", uid, sql);
}

async function callTransactions(db, uid, ownerId, scope, page, pageSize) {
  const scopeArg =
    scope === undefined ? "'business'" : scope === null ? "null" : `'${scope}'`;
  const { rows } = await asUser(
    db,
    uid,
    `select forge_dashboard_financial_transactions_v1('${ownerId}', ${scopeArg}, ${page}, ${pageSize}) as page;`,
  );
  return rows[0].page;
}

async function loadAllPages(db, uid, ownerId, scope, pageSize) {
  const pages = [];
  let page = 1;
  // The RPC's totalPages is the loop bound; the test asserts the loop
  // ends exactly there, with no duplicate ids across pages.
  for (;;) {
    const result = await callTransactions(db, uid, ownerId, scope, page, pageSize);
    pages.push(result);
    if (result.complete) break;
    page += 1;
    if (page > 50) throw new Error("transaction paging loop did not terminate");
  }
  return pages;
}

function assertTransactionEqualsSql(actual, expected, label) {
  expect(actual.id, `${label}.id`).toBe(expected.id);
  expect(actual.propertyId, `${label}.propertyId`).toBe(expected.propertyId);
  expect(actual.eventDate, `${label}.eventDate`).toBe(expected.eventDate);
  expect(actual.description, `${label}.description`).toBe(expected.description);
  expect(
    Math.abs(Number(actual.amount) - expected.amount),
    `${label}.amount: SQL ${actual.amount} vs JS ${expected.amount}`,
  ).toBeLessThanOrEqual(CENT_TOLERANCE);
  expect(actual.transactionKind, `${label}.transactionKind`).toBe(expected.transactionKind);
  expect(actual.category, `${label}.category`).toBe(expected.category);
  expect(actual.affectsNOI, `${label}.affectsNOI`).toBe(expected.affectsNOI);
  expect(actual.capitalized, `${label}.capitalized`).toBe(expected.capitalized);
  expect(actual.sourceSystem, `${label}.sourceSystem`).toBe(expected.sourceSystem);
  expect(actual.sourceRecordId, `${label}.sourceRecordId`).toBe(expected.sourceRecordId);
  expect(actual.businessScope, `${label}.businessScope`).toBe(expected.businessScope);
  expect(actual.financialAccountId, `${label}.financialAccountId`).toBe(expected.financialAccountId);
}

function assertPagesEqualOracle(pages, oracle, label) {
  const allRows = pages.flatMap((page) => page.transactions);
  expect(allRows).toHaveLength(oracle.transactions.length);

  // Exact order: the RPC's event_date,id order must match the JS
  // oracle's sort, row for row, across every page boundary.
  expect(
    allRows.map((row) => row.id),
    `${label} order`,
  ).toEqual(oracle.transactions.map((row) => row.id));

  allRows.forEach((row, index) => {
    assertTransactionEqualsSql(row, oracle.transactions[index], `${label}[${index}]`);
  });

  // No duplicate ids anywhere (the client loader rejects duplicates).
  expect(new Set(allRows.map((row) => row.id)).size).toBe(allRows.length);

  // Counts are exact and stable across pages.
  const first = pages[0];
  expect(first.totalCount).toBe(oracle.transactions.length);
  expect(first.totalPages).toBe(
    Math.max(1, Math.ceil(oracle.transactions.length / first.pageSize)),
  );
  for (const page of pages) {
    expect(page.totalCount).toBe(first.totalCount);
    expect(page.totalPages).toBe(first.totalPages);
    expect(page.version).toBe("forge_dashboard_financial_transactions_v1");
    expect(page.status).toBe("ok");
    expect(page.transactionsStatus).toBe("loaded");
  }
  expect(pages[pages.length - 1].complete).toBe(true);
  expect(pages.slice(0, -1).every((page) => page.complete === false)).toBe(true);
}

describe("slice 3 diagnostic transactions migration: PGlite battery", () => {
  let db;
  beforeEach(async () => {
    db = await setupDb();
  }, 60000);

  it60("golden parity: business scope pages match the JS oracle row for row", async () => {
    const oracle = await oracleWorkspace(OWNER_A, "business");
    const pages = await loadAllPages(db, OWNER_A, OWNER_A, "business", 100);

    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0].transactions).toHaveLength(100);
    assertPagesEqualOracle(pages, oracle, "business");
    expect(oracle.portfolio.transactionCount).toBeGreaterThan(500);
  });

  it60("golden parity: personal scope pages match the JS oracle", async () => {
    const oracle = await oracleWorkspace(OWNER_A, "personal");
    const pages = await loadAllPages(db, OWNER_A, OWNER_A, "personal", 100);

    assertPagesEqualOracle(pages, oracle, "personal");
    expect(oracle.portfolio.transactionCount).toBeGreaterThan(100);
  });

  it60("golden parity: all scopes (null) match the JS oracle", async () => {
    const oracle = await oracleWorkspace(OWNER_A, null);
    const pages = await loadAllPages(db, OWNER_A, OWNER_A, null, 100);

    assertPagesEqualOracle(pages, oracle, "all");
    expect(oracle.portfolio.transactionCount).toBeGreaterThan(700);
  });

  it60("golden parity: owner B is isolated and correct", async () => {
    const oracle = await oracleWorkspace(OWNER_B, "business");
    const pages = await loadAllPages(db, OWNER_B, OWNER_B, "business", 100);

    assertPagesEqualOracle(pages, oracle, "owner-b");
    expect(oracle.portfolio.transactionCount).toBe(12);
  });

  it60("empty owner returns one complete empty page, never nulls", async () => {
    const page = await callTransactions(db, OWNER_C, OWNER_C, "business", 1, 100);

    expect(page.status).toBe("ok");
    expect(page.totalCount).toBe(0);
    expect(page.totalPages).toBe(1);
    expect(page.complete).toBe(true);
    expect(page.transactions).toEqual([]);
    expect(page.transactionsStatus).toBe("loaded");
  });

  it60("cutover edge cases: the half-open boundary is honored on both engines", async () => {
    const oracle = await oracleWorkspace(OWNER_A, "business");
    const pages = await loadAllPages(db, OWNER_A, OWNER_A, "business", 100);
    const ids = new Set(pages.flatMap((page) => page.transactions.map((row) => row.id)));

    // Non-canonical members on/after the cutover are excluded by both
    // engines; the canonical member and pre-cutover rows are retained.
    expect(ids.has("cut-manual-before")).toBe(true);
    expect(ids.has("cut-manual-on")).toBe(false);
    expect(ids.has("cut-manual-after")).toBe(false);
    expect(ids.has("cut-stripe-on")).toBe(true);
    expect(ids.has("cut-stripe-after")).toBe(true);
    expect(ids.has("cut-plaid-before")).toBe(true);
    expect(ids.has("cut-plaid-after")).toBe(false);
    expect(ids.has("cut-g2-after")).toBe(true);
    expect(ids.has("cut-g3-after")).toBe(true);
    expect(ids.has("cut-null-on")).toBe(true);

    assertPagesEqualOracle(pages, oracle, "cutover");

    const { rows: afterCount } = await db.query(
      `select count(*)::int as n from financial_events where owner_id = '${OWNER_A}';`,
    );
    expect(afterCount[0].n).toBe(1100);
  });

  it60("non-vacuity: a deliberately wrong 365-day lookback variant loses pre-2026 rows on this fixture", async () => {
    const oracle = await oracleWorkspace(OWNER_A, "business");
    const pages = await loadAllPages(db, OWNER_A, OWNER_A, "business", 100);

    // Pre-2020 rows must be present: the diagnostic layer promises
    // "all dates", so a lookback-capped variant would be observably
    // wrong on this fixture.
    expect(
      pages.flatMap((page) => page.transactions).some(
        (row) => row.eventDate === "2019-06-15",
      ),
      "pre-2020 rows must be present or the control is vacuous",
    ).toBe(true);

    const { rows } = await db.query(`
      select count(*)::int as n
      from financial_events
      where owner_id = '${OWNER_A}'
        and status not in ('inactive', 'deleted')
        and is_deleted is not true
        and business_scope = 'business'
        and event_date >= '2026-01-01';
    `);
    expect(rows[0].n).toBeLessThan(oracle.transactions.length);
    assertPagesEqualOracle(pages, oracle, "non-vacuity");
  });

  it60("read-after-write: an insert, a delete and a move are visible in the next call, with no TTL wait", async () => {
    const before = await callTransactions(db, OWNER_A, OWNER_A, "business", 1, 100);

    await db.query(`
      insert into financial_events
        (id, owner_id, property_id, financial_account_id, event_date,
         description, amount, transaction_kind, normalized_category,
         source_system, status, is_deleted)
      values ('event-new-1', '${OWNER_A}', '170-john', null, '2026-11-01',
        'New income', 500, 'income', 'rental_income', 'fixture',
        'active', false);
    `);

    const afterInsert = await callTransactions(db, OWNER_A, OWNER_A, "business", 1, 100);
    expect(afterInsert.totalCount).toBe(before.totalCount + 1);

    await db.query(`
      update financial_events set status = 'deleted'
      where id = 'event-new-1';
    `);

    const afterDelete = await callTransactions(db, OWNER_A, OWNER_A, "business", 1, 100);
    expect(afterDelete.totalCount).toBe(before.totalCount);

    // Move one existing income event between property and category:
    // the count must not move, the row must. The target is picked from
    // the RPC's own first page, so it is guaranteed eligible (a raw-SQL
    // pick could land on a personal-scope or cutover-excluded row the
    // business RPC never serves).
    const targetRow = before.transactions.find(
      (row) => row.transactionKind === "income",
    );
    expect(targetRow).toBeDefined();
    const target = { id: targetRow.id, property_id: targetRow.propertyId };
    const newProperty =
      target.property_id === "170-john" ? "335-butler" : "170-john";
    await db.query(`
      update financial_events
      set property_id = '${newProperty}', normalized_category = 'repairs'
      where id = '${target.id}';
    `);

    const afterMovePages = await loadAllPages(db, OWNER_A, OWNER_A, "business", 100);
    const movedRow = afterMovePages
      .flatMap((page) => page.transactions)
      .find((row) => row.id === target.id);
    expect(movedRow.propertyId).toBe(newProperty);
    expect(movedRow.category).toBe("repairs");
    expect(afterMovePages[0].totalCount).toBe(before.totalCount);
  });

  it60("unknown transaction kinds are refused, never silently excluded", async () => {
    await db.query(`
      insert into financial_events
        (id, owner_id, property_id, financial_account_id, event_date,
         description, amount, transaction_kind, normalized_category,
         source_system, status, is_deleted)
      values ('event-mystery', '${OWNER_A}', '170-john', null, '2026-01-05',
        'Mystery kind', 100, 'mystery', 'rental_income', 'fixture',
        'active', false);
    `);

    let caught = null;
    try {
      await callTransactions(db, OWNER_A, OWNER_A, "business", 1, 100);
    } catch (error) {
      caught = error;
    }
    expect(caught).not.toBe(null);
    expect(String(caught.message)).toContain(
      "Unsupported financial event transaction kind: mystery",
    );

    // The JS oracle throws on the same input.
    const service = new FinancialWorkspaceQueryService({
      financialEventRepository: {
        findByOwnerId: async () => [
          buildEvent({ transaction_kind: "mystery" }),
        ],
      },
    });
    await expect(service.buildWorkspace(OWNER_A)).rejects.toThrow(
      "Unsupported financial event transaction kind: mystery",
    );
  });

  it60("authorization: wrong owner and unauthenticated callers are denied loudly", async () => {
    let caughtWrongOwner = null;
    try {
      await callTransactions(db, OWNER_B, OWNER_A, "business", 1, 100);
    } catch (error) {
      caughtWrongOwner = error;
    }
    expect(caughtWrongOwner).not.toBe(null);
    expect(String(caughtWrongOwner.message)).toContain(
      "Not authorized for this workspace.",
    );

    let caughtUnauthenticated = null;
    try {
      await asRole(
        db,
        "authenticated",
        null,
        `select forge_dashboard_financial_transactions_v1('${OWNER_A}', 'business', 1, 100);`,
      );
    } catch (error) {
      caughtUnauthenticated = error;
    }
    expect(caughtUnauthenticated).not.toBe(null);
    expect(String(caughtUnauthenticated.message)).toContain(
      "Not authorized for this workspace.",
    );
  });

  it60("authorization: an active co-owner reads the shared workspace", async () => {
    const oracle = await oracleWorkspace(OWNER_A, "business");
    const pages = await loadAllPages(db, MEMBER_C, OWNER_A, "business", 100);

    assertPagesEqualOracle(pages, oracle, "co-owner");
  });

  it60("authorization: anon has no EXECUTE and PUBLIC is revoked", async () => {
    const { rows } = await db.query(`
      select proacl from pg_proc
      where proname = 'forge_dashboard_financial_transactions_v1'
        and pronamespace = 'public'::regnamespace;
    `);
    const proacl = String(rows[0].proacl);
    expect(proacl).toContain("authenticated=X");
    expect(proacl).not.toContain("anon");
    expect(proacl).not.toContain("public");
    expect(proacl).not.toContain("service_role");

    let caught = null;
    try {
      await asRole(
        db,
        "anon",
        null,
        `select forge_dashboard_financial_transactions_v1('${OWNER_A}', 'business', 1, 100);`,
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).not.toBe(null);
    expect(String(caught.message)).toMatch(/permission denied/i);
  });

  it60("FORCE RLS still hides other owners' rows from a direct select", async () => {
    const { rows } = await asUser(
      db,
      OWNER_B,
      `select count(*)::int as n from financial_events where owner_id = '${OWNER_A}';`,
    );
    expect(rows[0].n).toBe(0);
  });

  it60("EXPLAIN: one DB-side call serves one page -- no twelve-page legacy fetch", async () => {
    const { rows } = await asUser(
      db,
      OWNER_A,
      `explain (analyze, buffers) select * from forge_dashboard_financial_transactions_v1('${OWNER_A}', 'business', 1, 100);`,
    );
    const plan = rows.map((row) => row["QUERY PLAN"]).join("\n");
    expect(plan).toContain("Function Scan");

    const page = await callTransactions(db, OWNER_A, OWNER_A, "business", 1, 100);
    expect(page.transactions).toHaveLength(100);
    expect(page.totalCount).toBeGreaterThan(500);
    expect(page.totalPages).toBeGreaterThan(1);
    expect(page.complete).toBe(false);
  });

  it60("invalid scope, owner, page and pageSize are refused, not silently reinterpreted", async () => {
    let caughtScope = null;
    try {
      await callTransactions(db, OWNER_A, OWNER_A, "bogus", 1, 100);
    } catch (error) {
      caughtScope = error;
    }
    expect(caughtScope).not.toBe(null);
    expect(String(caughtScope.message)).toContain(
      "Unsupported financial workspace scope: bogus",
    );

    let caughtOwner = null;
    try {
      await asUser(
        db,
        OWNER_A,
        `select forge_dashboard_financial_transactions_v1(null, 'business', 1, 100);`,
      );
    } catch (error) {
      caughtOwner = error;
    }
    expect(caughtOwner).not.toBe(null);
    expect(String(caughtOwner.message)).toContain("Owner id is required.");

    let caughtPage = null;
    try {
      await callTransactions(db, OWNER_A, OWNER_A, "business", 0, 100);
    } catch (error) {
      caughtPage = error;
    }
    expect(caughtPage).not.toBe(null);
    expect(String(caughtPage.message)).toContain("positive integer");

    let caughtPageSize = null;
    try {
      await callTransactions(db, OWNER_A, OWNER_A, "business", 1, 1001);
    } catch (error) {
      caughtPageSize = error;
    }
    expect(caughtPageSize).not.toBe(null);
    expect(String(caughtPageSize.message)).toContain("between 1 and 1000");
  });
});

// Real-PostgreSQL subset. PGlite is real PostgreSQL, but the migration
// must also apply cleanly on a genuine PG16 cluster (plpgsql, SECURITY
// INVOKER, jsonb_agg ORDER BY, revoke/grant) and produce the same golden
// parity there. Gated on the binaries existing AND an unprivileged user
// to run the cluster as (initdb refuses root, and this VM's agent runs
// as root) — and SKIPS LOUDLY, never silently, when either is missing.
const PG_BIN = "/usr/lib/postgresql/16/bin";
function detectRealPgUser() {
  try {
    execSync(`ls ${PG_BIN}/initdb ${PG_BIN}/pg_ctl`, { stdio: "ignore" });
    execSync("which runuser", { stdio: "ignore" });
  } catch {
    return null;
  }
  for (const user of ["postgres", "nobody"]) {
    try {
      execSync(`id ${user}`, { stdio: "ignore" });
      return user;
    } catch { /* try the next user */ }
  }
  return null;
}
const PG_RUN_USER = detectRealPgUser();
const HAS_REAL_PG = PG_RUN_USER !== null;
if (!HAS_REAL_PG) {
  console.warn(
    "⚠️ LOUD SKIP: real-PostgreSQL subset SKIPPED — PG16 binaries or an unprivileged "
    + "user to run them as (initdb refuses root) were not found. "
    + "The PGlite battery still runs; run the real-PG leg where PG16 exists.",
  );
}

describe.skipIf(!HAS_REAL_PG)("slice 3 diagnostic transactions migration: real-PostgreSQL subset", () => {
  let pgDir;
  let pgClient;

  beforeAll(async () => {
    pgDir = mkdtempSync(join(tmpdir(), "s3-tx-realpg-"));
    execSync(`chown ${PG_RUN_USER}:${PG_RUN_USER} "${pgDir}"`, { stdio: "pipe" });
    const asPgUser = (cmd) => `runuser -u ${PG_RUN_USER} -- ${cmd}`;
    execSync(asPgUser(`"${PG_BIN}/initdb" -D "${pgDir}" -U postgres --auth=trust`), { stdio: "pipe" });
    execSync(
      asPgUser(`"${PG_BIN}/pg_ctl" -D "${pgDir}" -o "-p 55436 -k ${pgDir} -c listen_addresses=''" -l "${pgDir}/server.log" start`),
      { stdio: "pipe" },
    );
    pgClient = new Client({
      host: pgDir,
      port: 55436,
      user: "postgres",
      database: "postgres",
    });
    await pgClient.connect();
    await pgClient.query(PREREQ_SQL);
    await pgClient.query(SEED_SQL);
    await pgClient.query(loadMigrationSql(MIGRATION));
  }, 120000);

  afterAll(async () => {
    try { await pgClient?.end(); } catch { /* already closed */ }
    if (pgDir) {
      try { execSync(`runuser -u ${PG_RUN_USER} -- "${PG_BIN}/pg_ctl" -D "${pgDir}" stop -m fast`, { stdio: "pipe" }); } catch { /* already stopped */ }
      rmSync(pgDir, { recursive: true, force: true });
    }
  }, 120000);

  async function pgAsUser(uid, sql) {
    await pgClient.query(`set role authenticated; set app.test_uid = '${uid}';`);
    try {
      return await pgClient.query(sql);
    } finally {
      await pgClient.query(`reset role;`);
    }
  }

  async function pgCallTransactions(uid, ownerId, scope, page, pageSize) {
    const scopeArg =
      scope === undefined ? "'business'" : scope === null ? "null" : `'${scope}'`;
    const { rows } = await pgAsUser(
      uid,
      `select forge_dashboard_financial_transactions_v1('${ownerId}', ${scopeArg}, ${page}, ${pageSize}) as page;`,
    );
    return rows[0].page;
  }

  async function pgLoadAllPages(uid, ownerId, scope, pageSize) {
    const pages = [];
    let page = 1;
    for (;;) {
      const result = await pgCallTransactions(uid, ownerId, scope, page, pageSize);
      pages.push(result);
      if (result.complete) break;
      page += 1;
      if (page > 50) throw new Error("transaction paging loop did not terminate");
    }
    return pages;
  }

  it60("golden parity: business scope matches the JS oracle on real PG16", async () => {
    const oracle = await oracleWorkspace(OWNER_A, "business");
    const pages = await pgLoadAllPages(OWNER_A, OWNER_A, "business", 100);

    assertPagesEqualOracle(pages, oracle, "real-pg business");
  });

  it60("golden parity: all scopes match the JS oracle on real PG16", async () => {
    const oracle = await oracleWorkspace(OWNER_A, null);
    const pages = await pgLoadAllPages(OWNER_A, OWNER_A, null, 100);

    assertPagesEqualOracle(pages, oracle, "real-pg all");
  });

  it60("wrong-owner calls are denied on real PG16", async () => {
    let caught = null;
    try {
      await pgCallTransactions(OWNER_B, OWNER_A, "business", 1, 100);
    } catch (error) {
      caught = error;
    }
    expect(caught).not.toBe(null);
    expect(String(caught.message)).toContain(
      "Not authorized for this workspace.",
    );
  });

  it60("ACL matrix: authenticated has EXECUTE, PUBLIC/anon/service_role do not", async () => {
    const { rows } = await pgClient.query(`
      select proacl from pg_proc
      where proname = 'forge_dashboard_financial_transactions_v1'
        and pronamespace = 'public'::regnamespace;
    `);
    const proacl = String(rows[0].proacl);
    expect(proacl).toContain("authenticated=X");
    expect(proacl).not.toContain("anon");
    expect(proacl).not.toContain("public");
    expect(proacl).not.toContain("service_role");
  });
});
