import { describe, expect, it } from "vitest";
import {
  buildPackageCostSummary,
  formatCents,
  normalizePlannedCostCents,
  parseDecimalAmountToCents,
  parsePlannedBudgetToCents,
} from "./packageCosts.js";

const OWNER = "owner_1";
const PACKAGE = {
  id: "forge_wp_1",
  owner_id: OWNER,
  property_id: "1900-w-decker",
  planned_cost_cents: 15000,
};

function link(overrides = {}) {
  return {
    id: "link_1",
    owner_id: OWNER,
    relationship_type: "cost_attributed",
    source_domain: "financial",
    source_type: "financial_event",
    source_id: "event_1",
    target_domain: "workmgmt",
    target_type: "work_package",
    target_id: PACKAGE.id,
    status: "active",
    provenance: "user_confirmed",
    ...overrides,
  };
}

function event(overrides = {}) {
  return {
    id: "event_1",
    owner_id: OWNER,
    event_date: "2026-10-01",
    description: "Repairs",
    amount: "125.35",
    transaction_kind: "expense",
    property_id: "1900-w-decker",
    source_system: "manual",
    source_record_id: null,
    metadata: null,
    status: "active",
    is_deleted: false,
    ...overrides,
  };
}

function summary(overrides = {}) {
  return buildPackageCostSummary({
    package: PACKAGE,
    ownerId: OWNER,
    links: [link()],
    events: [event()],
    contractorPayments: [],
    unitIds: ["unit_1"],
    ...overrides,
  });
}

describe("exact decimal money parsing", () => {
  it("parses decimal strings to exact cents without float drift", () => {
    expect(parseDecimalAmountToCents("125.35")).toEqual({ ok: true, cents: 12535 });
    expect(parseDecimalAmountToCents("74.65")).toEqual({ ok: true, cents: 7465 });
    expect(parseDecimalAmountToCents(125.35)).toEqual({ ok: true, cents: 12535 });
    expect(formatCents(20000)).toBe("$200.00");
  });

  it("rejects extra decimals, non-decimal notation, and overflow instead of rounding or zeroing", () => {
    expect(parseDecimalAmountToCents("1.234").ok).toBe(false);
    expect(parseDecimalAmountToCents("1e3").ok).toBe(false);
    expect(parseDecimalAmountToCents("9007199254740993.00").ok).toBe(false);
    expect(parseDecimalAmountToCents("not-money").ok).toBe(false);
  });

  it("distinguishes no budget from an explicit zero budget", () => {
    expect(parsePlannedBudgetToCents("")).toEqual({ ok: true, cents: null });
    expect(parsePlannedBudgetToCents("0.00")).toEqual({ ok: true, cents: 0 });
    expect(parsePlannedBudgetToCents("$1,250.00")).toEqual({ ok: true, cents: 125000 });
    expect(parsePlannedBudgetToCents("-1.00").ok).toBe(false);
    expect(parsePlannedBudgetToCents("1.234").ok).toBe(false);
    expect(normalizePlannedCostCents(125000)).toEqual({ ok: true, cents: 125000 });
    expect(normalizePlannedCostCents(-1).ok).toBe(false);
    expect(normalizePlannedCostCents(1.5).ok).toBe(false);
  });
});

describe("buildPackageCostSummary", () => {
  it("sums two eligible expenses exactly and reports over-budget variance", () => {
    const result = summary({
      links: [
        link({ id: "link_1", source_id: "event_1" }),
        link({ id: "link_2", source_id: "event_2" }),
      ],
      events: [
        event({ id: "event_1", amount: "125.35" }),
        event({ id: "event_2", amount: "74.65", event_date: "2026-10-02" }),
      ],
    });
    expect(result.plannedCostCents).toBe(15000);
    expect(result.actualCostCents).toBe(20000);
    expect(result.varianceCents).toBe(5000);
    expect(result.includedEventCount).toBe(2);
    expect(result.includedEventIds).toEqual(["event_1", "event_2"]);
    expect(result.provenance.linkIds).toEqual(["link_1", "link_2"]);
  });

  it("reports under-budget variance and preserves null versus zero planned budgets", () => {
    const under = summary({ package: { ...PACKAGE, planned_cost_cents: 17535 } });
    expect(under.varianceCents).toBe(-5000);

    const noPlan = summary({ package: { ...PACKAGE, planned_cost_cents: null } });
    expect(noPlan.hasPlan).toBe(false);
    expect(noPlan.plannedCostCents).toBeNull();
    expect(noPlan.varianceCents).toBeNull();

    const zeroPlan = summary({ package: { ...PACKAGE, planned_cost_cents: 0 } });
    expect(zeroPlan.hasPlan).toBe(true);
    expect(zeroPlan.plannedCostCents).toBe(0);
    expect(zeroPlan.varianceCents).toBe(12535);
  });

  it("counts duplicate links to the same event only once", () => {
    const result = summary({ links: [link({ id: "link_1" }), link({ id: "link_2" })] });
    expect(result.actualCostCents).toBe(12535);
    expect(result.includedEventCount).toBe(1);
    expect(result.duplicateLinkCount).toBe(1);
  });

  it("excludes an event actively attributed to multiple packages from every package total", () => {
    const links = [
      link({ id: "link_1", target_id: "forge_wp_1" }),
      link({ id: "link_2", target_id: "forge_wp_2" }),
    ];
    const first = summary({ links });
    const second = summary({
      package: { ...PACKAGE, id: "forge_wp_2" },
      links,
    });
    expect(first.actualCostCents).toBe(0);
    expect(second.actualCostCents).toBe(0);
    expect(first.ambiguousEventIds).toEqual(["event_1"]);
    expect(first.warnings.map((warning) => warning.code)).toContain("ambiguous_multiple_packages");
  });

  it("excludes foreign, inactive, unconfirmed, and broken links with reasons", () => {
    const result = summary({
      links: [
        link({ id: "foreign", source_id: "event_foreign", owner_id: "owner_2" }),
        link({ id: "inactive", source_id: "event_inactive", status: "stale" }),
        link({ id: "unconfirmed", source_id: "event_unconfirmed", provenance: "ai_proposed" }),
        link({ id: "broken", source_id: "event_missing", status: "broken" }),
      ],
      events: [
        event({ id: "event_foreign" }),
        event({ id: "event_inactive" }),
        event({ id: "event_unconfirmed" }),
      ],
    });
    expect(result.actualCostCents).toBe(0);
    expect(result.excludedEvents.map((item) => item.code)).toEqual([
      "foreign_owner_link",
      "inactive_link",
      "inactive_link",
      "unconfirmed_link",
    ]);
  });

  it("excludes income, deleted, inactive, unsafe-source, and invalid-amount events with explicit reasons", () => {
    const cases = [
      [{ transaction_kind: "income" }, "income_not_expense"],
      [{ is_deleted: true }, "deleted_event"],
      [{ status: "inactive" }, "inactive_event"],
      [{ source_system: "plaid" }, "unsupported_source"],
      [{ amount: "12.345" }, "invalid_amount"],
      [{ amount: "9007199254740993.00" }, "invalid_amount"],
    ];
    for (const [overrides, code] of cases) {
      const result = summary({ events: [event(overrides)] });
      expect(result.actualCostCents).toBe(0);
      expect(result.excludedEvents[0].code).toBe(code);
    }
  });

  it("accepts an alias-tagged event for the canonical package property and exact unit ids", () => {
    const alias = summary({ events: [event({ property_id: "1900-west-decker" })] });
    expect(alias.actualCostCents).toBe(12535);

    const unit = summary({ events: [event({ property_id: "unit_1" })] });
    expect(unit.actualCostCents).toBe(12535);
  });

  it("flags an unrelated property instead of allocating the event", () => {
    const result = summary({ events: [event({ property_id: "4800-kent-ave" })] });
    expect(result.actualCostCents).toBe(0);
    expect(result.excludedEvents[0].code).toBe("property_mismatch");
  });

  it("for an unassigned package, includes only events with no property association", () => {
    const pkg = { ...PACKAGE, property_id: null };
    const included = summary({ package: pkg, events: [event({ property_id: null })] });
    expect(included.actualCostCents).toBe(12535);
    expect(included.scope).toBe("unassigned");

    const conflict = summary({ package: pkg, events: [event({ property_id: "1900-w-decker" })] });
    expect(conflict.actualCostCents).toBe(0);
    expect(conflict.excludedEvents[0].code).toBe("unassigned_property_conflict");
  });

  it("suppresses a verified contractor duplicate across the alias boundary", () => {
    const result = summary({
      events: [event({
        property_id: "1900-west-decker",
        source_record_id: "rental_contractor_payment_payment_1",
      })],
      contractorPayments: [{
        id: "payment_1",
        owner_id: OWNER,
        property_id: "1900-w-decker",
        amount_cents: 12535,
      }],
    });
    expect(result.actualCostCents).toBe(0);
    expect(result.suppressedContractorEventCount).toBe(1);
    expect(result.suppressedContractorAmountCents).toBe(12535);
    expect(result.warnings.map((warning) => warning.message)).toContain(
      "Contractor payout recorded separately; not included in package actuals",
    );
  });

  it("also verifies contractor references carried in metadata and exact unit ids", () => {
    const result = summary({
      events: [event({
        property_id: "unit_1",
        source_record_id: null,
        metadata: { contractor_payment_id: "payment_1" },
      })],
      contractorPayments: [{
        id: "payment_1",
        owner_id: OWNER,
        property_id: "unit_1",
        amount_cents: 12535,
      }],
    });
    expect(result.actualCostCents).toBe(0);
    expect(result.suppressedContractorEventCount).toBe(1);
  });

  it("does not suppress on a non-matching contractor amount or date/amount resemblance alone", () => {
    const mismatch = summary({
      events: [event({ source_record_id: "rental_contractor_payment_payment_1" })],
      contractorPayments: [{
        id: "payment_1", owner_id: OWNER, property_id: "1900-w-decker", amount_cents: 12000,
      }],
    });
    expect(mismatch.actualCostCents).toBe(12535);
    expect(mismatch.warnings.map((warning) => warning.code)).toContain("contractor_payment_amount_mismatch");

    const noExplicitReference = summary({
      contractorPayments: [{
        id: "payment_1", owner_id: OWNER, property_id: "1900-w-decker", amount_cents: 12535,
      }],
    });
    expect(noExplicitReference.actualCostCents).toBe(12535);
    expect(noExplicitReference.suppressedContractorEventCount).toBe(0);
  });

  it("never suppresses income through a contractor reference", () => {
    const result = summary({
      events: [event({
        transaction_kind: "income",
        source_record_id: "rental_contractor_payment_payment_1",
      })],
      contractorPayments: [{
        id: "payment_1", owner_id: OWNER, property_id: "1900-w-decker", amount_cents: 12535,
      }],
    });
    expect(result.excludedEvents[0].code).toBe("income_not_expense");
    expect(result.suppressedContractorEventCount).toBe(0);
  });
});
