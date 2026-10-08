import { describe, expect, it, vi } from "vitest";
import { getPackageCostSummary } from "./packageCosts.js";

// Supabase-shaped chain mock that records every predicate while returning the
// queued table result. The summary assertions below therefore prove both the
// filter calls and the pure builder's behavior over the returned rows.
function chain(result = { data: null, error: null }) {
  const node = {
    result,
    select: vi.fn(() => node),
    eq: vi.fn(() => node),
    in: vi.fn(() => node),
    order: vi.fn(() => node),
    range: vi.fn(() => node),
    limit: vi.fn(() => node),
    maybeSingle: vi.fn(async () => result),
    then: (resolve) => resolve(result),
  };
  return node;
}

function mockDb(chainsByTable) {
  const queues = new Map(Object.entries(chainsByTable).map(([table, chains]) => [table, [...chains]]));
  const calls = [];
  return {
    calls,
    from: vi.fn((table) => {
      const queue = queues.get(table) || [];
      if (queue.length === 0) throw new Error(`mockDb: no chain queued for ${table}`);
      const node = queue.shift();
      calls.push({ table, chain: node });
      return node;
    }),
  };
}

const OWNER = "owner_1";
const PKG = {
  id: "forge_wp_1", owner_id: OWNER, property_id: "1900-w-decker",
  planned_cost_cents: 15000, status: "in_progress", version: 4,
  updated_at: "2026-10-08T12:00:00.000Z",
};
const LINK = {
  id: "link_1", owner_id: OWNER, relationship_type: "cost_attributed",
  source_domain: "financial", source_type: "financial_event", source_id: "event_1",
  target_domain: "workmgmt", target_type: "work_package", target_id: "forge_wp_1",
  status: "active", provenance: "user_confirmed",
};
const EVENT = {
  id: "event_1", owner_id: OWNER, event_date: "2026-10-01", description: "Repairs",
  amount: "125.35", transaction_kind: "expense", property_id: "1900-west-decker",
  source_system: "manual", source_record_id: null, metadata: null,
  status: "active", is_deleted: false,
};

function dbFor({ pkg = PKG, links = [LINK], events = [EVENT], payments = [], revisions = [] } = {}) {
  return mockDb({
    forge_work_packages: [chain({ data: pkg, error: null })],
    rental_units: [chain({
      data: [
        { id: "unit_1", property_id: "1900-west-decker" },
        { id: "unit_2", property_id: "4800-kent-ave" },
      ],
      error: null,
    })],
    forge_work_links: [chain({ data: links, error: null }), chain({ data: links, error: null })],
    financial_events: events.length ? [chain({ data: events, error: null })] : [],
    rental_contractor_payments: payments.length ? [chain({ data: payments, error: null })] : [],
    forge_work_package_budget_revisions: [chain({ data: revisions, error: null })],
  });
}

describe("getPackageCostSummary", () => {
  it("returns 404 for a missing or cross-owner package without reading financial rows", async () => {
    const db = mockDb({ forge_work_packages: [chain({ data: null, error: null })] });
    const result = await getPackageCostSummary(db, { ownerId: OWNER, packageId: "foreign" });
    expect(result).toMatchObject({ ok: false, httpStatus: 404 });
    expect(db.from).toHaveBeenCalledTimes(1);
    const pkgChain = db.calls[0].chain;
    expect(pkgChain.eq).toHaveBeenCalledWith("owner_id", OWNER);
    expect(pkgChain.eq).toHaveBeenCalledWith("id", "foreign");
  });

  it("applies owner, exact-orientation link, finite event-id, and contractor-id filters", async () => {
    const db = dbFor({
      revisions: [{
        id: "rev_1", package_id: PKG.id, actor: "user_9", at: "2026-10-08T12:00:00.000Z",
        old_planned_cost_cents: null, new_planned_cost_cents: 15000, reason: "Initial budget",
      }],
    });
    const result = await getPackageCostSummary(db, { ownerId: OWNER, packageId: PKG.id });
    expect(result.ok).toBe(true);
    expect(result.summary.actualCostCents).toBe(12535);
    expect(result.summary.packageVersion).toBe(4);
    expect(result.summary.budgetRevisions[0].new_planned_cost_cents).toBe(15000);

    const byTable = Object.fromEntries(db.calls.map((call) => [call.table, call.chain]));
    const linkChains = db.calls.filter((call) => call.table === "forge_work_links").map((call) => call.chain);
    expect(byTable.rental_units.eq).toHaveBeenCalledWith("owner_id", OWNER);
    expect(linkChains).toHaveLength(2);
    for (const linkChain of linkChains) {
      expect(linkChain.eq).toHaveBeenCalledWith("owner_id", OWNER);
      expect(linkChain.eq).toHaveBeenCalledWith("relationship_type", "cost_attributed");
      expect(linkChain.eq).toHaveBeenCalledWith("source_domain", "financial");
      expect(linkChain.eq).toHaveBeenCalledWith("source_type", "financial_event");
      expect(linkChain.eq).toHaveBeenCalledWith("target_domain", "workmgmt");
      expect(linkChain.eq).toHaveBeenCalledWith("target_type", "work_package");
      expect(linkChain.range).toHaveBeenCalledWith(0, 999);
    }
    expect(linkChains[0].eq).toHaveBeenCalledWith("target_id", PKG.id);
    expect(linkChains[1].in).toHaveBeenCalledWith("source_id", ["event_1"]);
    expect(byTable.financial_events.eq).toHaveBeenCalledWith("owner_id", OWNER);
    expect(byTable.financial_events.in).toHaveBeenCalledWith("id", ["event_1"]);
    expect(byTable.forge_work_package_budget_revisions.eq).toHaveBeenCalledWith("owner_id", OWNER);
    expect(byTable.forge_work_package_budget_revisions.eq).toHaveBeenCalledWith("package_id", PKG.id);
    expect(byTable.forge_work_package_budget_revisions.limit).toHaveBeenCalledWith(50);
    // No contractor query is needed when the event carries no explicit reference.
    expect(db.from).not.toHaveBeenCalledWith("rental_contractor_payments");
  });

  it("queries contractor payments only by finite explicit ids and suppresses the verified duplicate", async () => {
    const db = dbFor({
      events: [{ ...EVENT, source_record_id: "rental_contractor_payment_payment_1" }],
      payments: [{
        id: "payment_1", owner_id: OWNER, property_id: "1900-w-decker", amount_cents: 12535,
      }],
    });
    const result = await getPackageCostSummary(db, { ownerId: OWNER, packageId: PKG.id });
    expect(result.summary.actualCostCents).toBe(0);
    expect(result.summary.suppressedContractorEventCount).toBe(1);
    const paymentsChain = db.calls.find((call) => call.table === "rental_contractor_payments").chain;
    expect(paymentsChain.eq).toHaveBeenCalledWith("owner_id", OWNER);
    expect(paymentsChain.in).toHaveBeenCalledWith("id", ["payment_1"]);
    expect(paymentsChain.range).toHaveBeenCalledWith(0, 999);
  });

  it("does not count a foreign-owner event returned behind the owner filter", async () => {
    const db = dbFor({ events: [{ ...EVENT, owner_id: "owner_2" }] });
    const result = await getPackageCostSummary(db, { ownerId: OWNER, packageId: PKG.id });
    expect(result.summary.actualCostCents).toBe(0);
    expect(result.summary.excludedEvents[0].code).toBe("event_not_found");
  });
});
