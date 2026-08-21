import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Migration 20260821000000 drops the two-column unique constraint that every
// payment_webhook_events upsert's onConflict target used to name, and replaces it with a
// three-column constraint that includes provider_mode. Supabase's PostgREST upsert requires the
// onConflict column list to exactly match an existing unique/exclusion constraint — an upsert
// naming a target that isn't a real constraint fails with Postgres error 42P10 ("no unique or
// exclusion constraint matching the ON CONFLICT specification"). This was a deployment-safety-
// review finding (both webhook routes still named the dropped two-column target) — see
// stripe-rpc-provider-mode.migration.test.js's equivalent check for record_stripe_rental_settlement,
// whose conflict target was already correct; this file covers the two JS-level
// payment_webhook_events upserts that were missed.
const migrationSql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260821000000_add_stripe_provider_mode_isolation.sql"),
  "utf8",
).toLowerCase().replace(/\s+/g, " ");

const WEBHOOK_ROUTES = [
  { label: "payment webhook", path: "src/app/api/rental/stripe-webhook/route.js" },
  { label: "account thin-event webhook", path: "src/app/api/rental/stripe-account-webhook/route.js" },
];

// Extracted from the migration text itself (not hardcoded) so this suite stays tied to whatever
// the migration actually declares, rather than to what we currently believe it declares.
const constraintColumnsMatch = migrationSql.match(
  /add constraint payment_webhook_events_provider_mode_event_id_key\s*unique \(([^)]+)\)/,
);
const constraintColumns = constraintColumnsMatch[1].split(",").map((c) => c.trim());

describe("payment_webhook_events upsert onConflict targets match the live unique constraint", () => {
  it("migration 20260821000000 drops the old two-column constraint and replaces it with a three-column constraint including provider_mode", () => {
    expect(migrationSql).toContain("drop constraint if exists payment_webhook_events_provider_provider_event_id_key");
    expect(constraintColumns).toEqual(["provider", "provider_mode", "provider_event_id"]);
  });

  it.each(WEBHOOK_ROUTES)("$label ($path) upserts payment_webhook_events with the exact three-column post-migration conflict target", ({ path }) => {
    const source = readFileSync(resolve(process.cwd(), path), "utf8");
    const onConflictMatch = source.match(/from\("payment_webhook_events"\)\.upsert\([\s\S]*?onConflict:\s*"([^"]+)"/);
    expect(onConflictMatch, `expected a payment_webhook_events upsert with an onConflict target in ${path}`).not.toBeNull();
    const targetColumns = onConflictMatch[1].split(",").map((c) => c.trim());
    expect(targetColumns).toEqual(constraintColumns);
  });

  it.each(WEBHOOK_ROUTES)("$label ($path) stores provider_mode on every upserted event — never omitted, never a literal guess", ({ path }) => {
    const source = readFileSync(resolve(process.cwd(), path), "utf8");
    const upsertBlockMatch = source.match(/from\("payment_webhook_events"\)\.upsert\(\{([\s\S]*?)\},\s*\{ onConflict/);
    expect(upsertBlockMatch, `expected a payment_webhook_events upsert payload in ${path}`).not.toBeNull();
    const upsertBlock = upsertBlockMatch[1];
    // Must come from the server's own resolved provider.mode (createStripeBillingProvider() /
    // resolveStripeMode(), which fails closed on missing/invalid config) — never a string literal
    // like "test" or "live", which would be a silent, unvalidated guess.
    expect(upsertBlock).toMatch(/provider_mode:\s*provider\.mode\b/);
    expect(upsertBlock).not.toMatch(/provider_mode:\s*"(test|live)"/);
  });

  it.each(WEBHOOK_ROUTES)("$label ($path)'s pre-upsert duplicate-delivery lookup is also scoped by provider_mode, not just provider and provider_event_id", ({ path }) => {
    const source = readFileSync(resolve(process.cwd(), path), "utf8");
    const lookupMatch = source.match(/from\("payment_webhook_events"\)\s*\n?\s*\.select\("status"\)((?:\.eq\("[^"]+",\s*[^)]+\))+)\.maybeSingle\(\)/);
    expect(lookupMatch, `expected a payment_webhook_events duplicate-delivery lookup in ${path}`).not.toBeNull();
    const eqCalls = [...lookupMatch[1].matchAll(/\.eq\("([^"]+)",/g)].map((m) => m[1]);
    // Order doesn't matter for correctness, only that provider_mode is scoped alongside the other two
    // — without it, a same-valued provider_event_id from the opposite mode could be misread as a
    // duplicate of this mode's event.
    expect(eqCalls.sort()).toEqual(["provider", "provider_event_id", "provider_mode"].sort());
  });
});

// The (provider, provider_mode, provider_event_id) constraint the routes now target is what gives
// Postgres its ON CONFLICT behavior. Since no migration is applied and no real database is
// available in this review, these tests model that exact constraint in memory — keyed by the same
// column list extracted above — to give a genuine behavioral proof of the two properties the
// constraint is responsible for, rather than only asserting matching strings.
function upsertModel(store, row) {
  const key = constraintColumns.map((column) => row[column]).join(" ");
  const existing = store.get(key);
  store.set(key, existing ? { ...existing, ...row } : { ...row });
  return store.get(key);
}

describe("(provider, provider_mode, provider_event_id) constraint semantics modeled from the migration", () => {
  it("test-mode and live-mode events sharing the same provider_event_id are isolated — neither upsert ever overwrites the other", () => {
    const store = new Map();
    upsertModel(store, { provider: "stripe", provider_mode: "test", provider_event_id: "evt_shared", status: "received" });
    upsertModel(store, { provider: "stripe", provider_mode: "live", provider_event_id: "evt_shared", status: "received" });
    expect(store.size).toBe(2);
    const testRow = upsertModel(store, { provider: "stripe", provider_mode: "test", provider_event_id: "evt_shared", status: "processed" });
    expect(testRow.status).toBe("processed");
    const liveRow = [...store.values()].find((row) => row.provider_mode === "live");
    expect(liveRow.status).toBe("received"); // untouched by the test-mode update
  });

  it("retrying delivery of the same event within the same mode is idempotent — it updates the one existing row, never inserts a duplicate", () => {
    const store = new Map();
    upsertModel(store, { provider: "stripe", provider_mode: "test", provider_event_id: "evt_retry", status: "received" });
    upsertModel(store, { provider: "stripe", provider_mode: "test", provider_event_id: "evt_retry", status: "received" });
    const final = upsertModel(store, { provider: "stripe", provider_mode: "test", provider_event_id: "evt_retry", status: "processed" });
    expect(store.size).toBe(1);
    expect(final.status).toBe("processed");
  });
});
