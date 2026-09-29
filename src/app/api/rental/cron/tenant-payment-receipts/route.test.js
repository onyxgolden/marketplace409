// Dry-run and first-write-wins proof for the rental tenant receipt cron
// route: ?dryRun=true must calculate the full plan (reconcile + wouldSend)
// without constructing the email provider and without any database write;
// the reconciler's upsert must never reset a row another writer already
// recorded. Synthetic fixtures only.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/createRentalWebhookClient", () => ({ createRentalWebhookClient: vi.fn() }));
vi.mock("@/infrastructure/notifications/ResendRentalEmailProvider", () => ({
  createResendRentalEmailProvider: vi.fn(),
}));

import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { createResendRentalEmailProvider } from "@/infrastructure/notifications/ResendRentalEmailProvider";
import { GET } from "./route.js";

const OWNER = "owner_fixture";
const TENANT = "rental_tenant_fixture_eric";
const LEASE = "lease_fixture_1";
const PAYMENT_ID = "rental_payment_fixture_1";

// Recording mock db: every write is captured so the test can prove zero
// database changes; reads resolve from the rows map.
function makeDb(rows = {}) {
  const writes = [];
  const resolveRows = (table, single) => {
    const value = rows[table];
    if (value === undefined) return single ? null : [];
    if (single) return Array.isArray(value) ? (value[0] ?? null) : value;
    return Array.isArray(value) ? value : [value];
  };
  const node = (table) => {
    const q = {
      select: () => q,
      eq: () => q,
      in: () => q,
      order: () => q,
      gte: () => q,
      range: () => q,
      is: () => q,
      maybeSingle: () => Promise.resolve({ data: resolveRows(table, true), error: null }),
      upsert: (row, opts) => {
        writes.push({ table, method: "upsert", row, opts });
        const uq = {
          select: () => uq,
          then: (resolve) => resolve({ data: resolveRows(table, false), error: null }),
        };
        return uq;
      },
      update: (patch) => {
        writes.push({ table, method: "update", patch });
        return q;
      },
      insert: (row) => {
        writes.push({ table, method: "insert", row });
        return q;
      },
      then: (resolve) => resolve({ data: resolveRows(table, false), error: null }),
    };
    return q;
  };
  return { db: { from: vi.fn((table) => node(table)) }, writes };
}

const PAYMENT_FIXTURE = {
  owner_id: OWNER,
  id: PAYMENT_ID,
  lease_id: LEASE,
  tenant_id: TENANT,
  amount_cents: 160000,
  provider_payment_id: "pi_fixture_123",
  succeeded_at: new Date().toISOString(),
};

function baseRows(overrides = {}) {
  return {
    rental_payments: [PAYMENT_FIXTURE],
    rental_tenant_receipt_deliveries: [],
    rental_tenants: [{ id: TENANT, display_name: "Fixture Tenant", email: "tenant-fixture@example.com" }],
    rental_leases: [{ property_id: "308-paula", unit_id: null }],
    ...overrides,
  };
}

const ENV_KEYS = [
  "CRON_SECRET",
  "RENTAL_NOTIFICATION_TENANT_IDS",
  "OWNER_PAYMENT_NOTIFICATION_OWNER_IDS",
  "OWNER_PAYMENT_NOTIFICATIONS_ENABLED",
  "OWNER_NOTIFICATION_QUIET_START",
  "OWNER_NOTIFICATION_QUIET_END",
];
let savedEnv = {};

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  process.env.CRON_SECRET = "test-secret";
  process.env.RENTAL_NOTIFICATION_TENANT_IDS = TENANT;
  process.env.OWNER_PAYMENT_NOTIFICATION_OWNER_IDS = OWNER;
  process.env.OWNER_PAYMENT_NOTIFICATIONS_ENABLED = "true";
  // startHour === endHour disables the quiet window deterministically.
  process.env.OWNER_NOTIFICATION_QUIET_START = "0";
  process.env.OWNER_NOTIFICATION_QUIET_END = "0";
  vi.clearAllMocks();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function authedRequest(url) {
  return new Request(url, { headers: { authorization: "Bearer test-secret" } });
}

describe("GET ?dryRun=true", () => {
  it("plans the tenant receipt when no delivery row exists yet, with zero writes", async () => {
    const { db, writes } = makeDb(baseRows());
    createRentalWebhookClient.mockReturnValue(db);

    const response = await GET(authedRequest("https://test/api?dryRun=true"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.dryRun).toBe(true);
    expect(body.reconciled).toBe(1);
    expect(body.wouldSend).toHaveLength(1);
    expect(body.wouldSend[0].to).toBe("tenant-fixture@example.com");
    expect(body.wouldSend[0].subject).toContain("Payment received: $1600.00");

    expect(createResendRentalEmailProvider).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it("still refuses unauthenticated callers in dry-run mode", async () => {
    const response = await GET(new Request("https://test/api?dryRun=true"));
    expect(response.status).toBe(401);
  });

  it("reconciler never resets a row that reached 'sent' between the snapshot and the upsert", async () => {
    // Stateful mock: the deliveries table is an in-memory map whose upsert
    // honors first-write-wins. The existence snapshot fires a side effect —
    // the webhook delivers the receipt (status 'sent') after the snapshot
    // was taken but before the reconciler's upsert runs.
    const store = new Map();
    const upsertCalls = [];
    const updateCalls = [];
    const statefulDb = {
      from: vi.fn((table) => {
        let cols = null;
        const q = {
          select: (c) => {
            cols = c;
            return q;
          },
          eq: () => q,
          in: () => q,
          order: () => q,
          gte: () => q,
          range: () => q,
          is: () => q,
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
          upsert: (row, opts) => {
            upsertCalls.push({ table, row, opts });
            const key = row.payment_id;
            let inserted;
            if (opts?.ignoreDuplicates && store.has(key)) {
              inserted = [];
            } else {
              store.set(key, { ...row });
              inserted = [{ id: row.id }];
            }
            const uq = {
              select: () => uq,
              then: (resolve) => resolve({ data: inserted, error: null }),
            };
            return uq;
          },
          update: (patch) => {
            updateCalls.push({ table, patch });
            return q;
          },
          then: (resolve) => {
            if (table === "rental_payments")
              return resolve({ data: [PAYMENT_FIXTURE], error: null });
            if (table === "rental_tenants")
              return resolve({
                data: [{ id: TENANT, email: "tenant-fixture@example.com" }],
                error: null,
              });
            if (table === "rental_tenant_receipt_deliveries") {
              if (cols === "payment_id") {
                // The race: the webhook's queue write lands here, after the
                // snapshot read but before the reconciler's upsert.
                if (!store.has(PAYMENT_ID))
                  store.set(PAYMENT_ID, { payment_id: PAYMENT_ID, status: "sent" });
                return resolve({ data: [], error: null });
              }
              // loadDeliveryCandidates: only queued/failed/sending rows are
              // candidates; the sent row is terminal and stays out.
              const rows = [...store.values()].filter((row) =>
                ["queued", "failed", "sending"].includes(row.status),
              );
              return resolve({ data: rows, error: null });
            }
            return resolve({ data: [], error: null });
          },
        };
        return q;
      }),
    };
    createRentalWebhookClient.mockReturnValue(statefulDb);

    const response = await GET(authedRequest("https://test/api"));
    const body = await response.json();

    expect(response.status).toBe(200);
    const deliveryUpserts = upsertCalls.filter(
      (call) => call.table === "rental_tenant_receipt_deliveries",
    );
    expect(deliveryUpserts).toHaveLength(1);
    expect(deliveryUpserts[0].opts.ignoreDuplicates).toBe(true);
    // The sent row was not reset to queued: no duplicate-send risk.
    expect(store.get(PAYMENT_ID).status).toBe("sent");
    // Honest counts: the no-op upsert is not reported as reconciled.
    expect(body.reconciled).toBe(0);
    expect(body.skippedAtDetection).toBe(0);
    // Nothing was deliverable, so no claim/outcome writes happened.
    expect(updateCalls).toHaveLength(0);
    expect(body.sent).toBe(0);
  });
});
