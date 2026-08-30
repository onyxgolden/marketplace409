import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { mapComponentRow, mapAccountTermsRow, mapEventRow, mapEventRowsForReplay, PersistedRowMappingError } from "../persistedRowMapping.js";
import { replayEvents } from "../replayEvents.js";
import { computeAccrual } from "../interestAccrual.js";
import { allocatePayment } from "../paymentAllocation.js";
import { roundToNearestCent } from "../currencyMath.js";
import { MalformedPrivateFinancingContractError } from "../privateFinancingContracts.js";

const componentRow = Object.freeze({
  owner_id: "owner-1", id: "comp_ib", account_id: "pf_acct_1", component_key: "ib", label: "Interest-bearing note",
  original_principal_cents: 4_500_000, rate_bps: 300, day_count_convention: "actual_365",
  scheduled_component_amount_cents: 43_452, allocation_priority: 1, effective_date: "2022-03-23", version_number: 1,
});

const termsRow = Object.freeze({
  owner_id: "owner-1", id: "terms_1", account_id: "pf_acct_1", version_number: 1, payment_frequency: "monthly",
  first_payment_due_date: "2022-04-23", regular_scheduled_payment_amount_cents: 51_785, maturity_date: null,
  allocation_policy: "scheduled_component_order", extra_payment_allocation_policy: "highest_rate_first_extra",
  prepayment_policy: "allowed_without_penalty_does_not_advance_due_date", day_count_convention: "actual_365",
  effective_date: "2022-03-23", acting_seller_id: "owner-1", amendment_reason: null,
});

describe("mapComponentRow", () => {
  it("maps a component row to the camelCase component-version shape", () => {
    expect(mapComponentRow(componentRow)).toEqual({
      ownerId: "owner-1", id: "comp_ib", accountId: "pf_acct_1", componentKey: "ib", label: "Interest-bearing note",
      originalPrincipalCents: 4_500_000, rateBps: 300, dayCountConvention: "actual_365",
      scheduledComponentAmountCents: 43_452, allocationPriority: 1, effectiveDate: "2022-03-23", versionNumber: 1,
    });
  });
});

describe("mapAccountTermsRow", () => {
  it("maps an account-terms row to the camelCase terms-version shape", () => {
    expect(mapAccountTermsRow(termsRow)).toEqual({
      ownerId: "owner-1", id: "terms_1", accountId: "pf_acct_1", versionNumber: 1, paymentFrequency: "monthly",
      firstPaymentDueDate: "2022-04-23", regularScheduledPaymentAmountCents: 51_785, maturityDate: null,
      allocationPolicy: "scheduled_component_order", extraPaymentAllocationPolicy: "highest_rate_first_extra",
      prepaymentPolicy: "allowed_without_penalty_does_not_advance_due_date", dayCountConvention: "actual_365",
      effectiveDate: "2022-03-23", actingSellerId: "owner-1", amendmentReason: null,
    });
  });
});

describe("mapEventRow", () => {
  it("maps common columns for every event type", () => {
    const row = {
      id: "pf_evt_1", owner_id: "owner-1", account_id: "pf_acct_1", event_type: "account_closed",
      event_origin: "interactive_user", created_by: "owner-1", source_reference: null, idempotency_key: null,
      ledger_sequence: 5, effective_date: "2026-08-01", recorded_at: "2026-08-01T00:00:00Z",
      reverses_event_id: null, reason: "paid off", internal_note: null, borrower_visible_explanation: null,
      closure_reason: "paid_in_full", payoff_concession_event_id: null,
    };
    const mapped = mapEventRow(row);
    expect(mapped).toMatchObject({
      id: "pf_evt_1", ownerId: "owner-1", accountId: "pf_acct_1", eventType: "account_closed",
      eventOrigin: "interactive_user", createdBy: "owner-1", ledgerSequence: 5, effectiveDate: "2026-08-01",
      closureReason: "paid_in_full", payoffConcessionEventId: null,
    });
  });

  it("maps payment_posted's amount, per-component allocation maps, and principalRemainingByComponentCents", () => {
    const row = {
      id: "pf_evt_2", event_type: "payment_posted", ledger_sequence: 2, effective_date: "2022-04-23",
      amount_cents: 51_785,
      interest_paid_by_component_cents: { ib: 0 },
      principal_paid_by_component_cents: { ib: 43_452, zi: 8_333 },
      unallocated_cents: 0,
      principal_remaining_by_component_cents: { ib: 4_456_548, zi: 991_667 },
      selected_extra_component_id: null,
    };
    const mapped = mapEventRow(row);
    expect(mapped.amountCents).toBe(51_785);
    expect(mapped.allocation).toEqual({
      interestPaidByComponentCents: { ib: 0 }, principalPaidByComponentCents: { ib: 43_452, zi: 8_333 }, unallocatedCents: 0,
    });
    expect(mapped.principalRemainingByComponentCents).toEqual({ ib: 4_456_548, zi: 991_667 });
    expect(mapped.selectedExtraComponentId).toBeNull();
  });

  it("maps principal_correction's correction-specific fields using componentId", () => {
    const row = {
      id: "pf_evt_3", event_type: "principal_correction", ledger_sequence: 3, effective_date: "2022-05-01",
      component_id: "zi", correction_basis: "discretionary_concession", delta_cents: -1000,
      corrected_component_principal_remaining_cents_after: 990_667,
    };
    const mapped = mapEventRow(row);
    expect(mapped.componentId).toBe("zi");
    expect(mapped.correctionBasis).toBe("discretionary_concession");
    expect(mapped.deltaCents).toBe(-1000);
    expect(mapped.correctedComponentPrincipalRemainingCentsAfter).toBe(990_667);
  });

  it("maps payoff_concession's per-component delta map and balance-snapshot map", () => {
    const row = {
      id: "pf_evt_4", event_type: "payoff_concession", ledger_sequence: 4, effective_date: "2026-08-23",
      delta_cents_by_component_cents: { ib: -1000, zi: 0 },
      principal_remaining_by_component_cents: { ib: 0, zi: 0 },
    };
    const mapped = mapEventRow(row);
    expect(mapped.deltaCentsByComponentCents).toEqual({ ib: -1000, zi: 0 });
    expect(mapped.principalRemainingByComponentCents).toEqual({ ib: 0, zi: 0 });
  });
});

describe("mapEventRowsForReplay -- round-trip through the real replay engine", () => {
  it("reconstructs a correct state from hand-built DB-row-shaped fixtures, proving no field is silently dropped", () => {
    const ib = { originalPrincipalCents: 4_500_000, rateBps: 300, scheduledComponentAmountCents: 43_452 };
    const zi = { originalPrincipalCents: 1_000_000, rateBps: 0, scheduledComponentAmountCents: 8_333 };
    const paymentAmountCents = 51_785;

    // Build the payment_posted row's own stored figures using the SAME engine replayEvents will use to
    // independently recompute them -- this fixture is correct by construction, not by hand-arithmetic
    // guesswork, and ledgerIntegrity.js's cross-check (replayEvents.js) proves the two agree.
    const accruedInterestCents = roundToNearestCent(
      computeAccrual({ principalRemainingCents: ib.originalPrincipalCents, rateBps: ib.rateBps, fromDate: "2022-03-23", toDate: "2022-04-23" }),
    );
    const allocation = allocatePayment({
      components: [
        { componentId: "ib", remainingPrincipalCents: ib.originalPrincipalCents, scheduledComponentAmountCents: ib.scheduledComponentAmountCents, rateBps: ib.rateBps, allocationPriority: 1 },
        { componentId: "zi", remainingPrincipalCents: zi.originalPrincipalCents, scheduledComponentAmountCents: zi.scheduledComponentAmountCents, rateBps: zi.rateBps, allocationPriority: 2 },
      ],
      accruedInterestCentsByComponent: { ib: accruedInterestCents },
      paymentAmountCents,
      allocationPolicy: "scheduled_component_order",
      extraPaymentAllocationPolicy: "highest_rate_first_extra",
    });

    const componentRows = [
      { owner_id: "owner-1", id: "comp_ib", account_id: "pf_acct_1", component_key: "ib", label: "IB", original_principal_cents: ib.originalPrincipalCents, rate_bps: ib.rateBps, day_count_convention: "actual_365", scheduled_component_amount_cents: ib.scheduledComponentAmountCents, allocation_priority: 1, effective_date: "2022-03-23", version_number: 1 },
      { owner_id: "owner-1", id: "comp_zi", account_id: "pf_acct_1", component_key: "zi", label: "ZI", original_principal_cents: zi.originalPrincipalCents, rate_bps: zi.rateBps, day_count_convention: "actual_365", scheduled_component_amount_cents: zi.scheduledComponentAmountCents, allocation_priority: 2, effective_date: "2022-03-23", version_number: 1 },
    ];
    const termsRows = [
      { owner_id: "owner-1", id: "terms_1", account_id: "pf_acct_1", version_number: 1, payment_frequency: "monthly", first_payment_due_date: "2022-04-23", regular_scheduled_payment_amount_cents: 51_785, maturity_date: null, allocation_policy: "scheduled_component_order", extra_payment_allocation_policy: "highest_rate_first_extra", prepayment_policy: "allowed_without_penalty_does_not_advance_due_date", day_count_convention: "actual_365", effective_date: "2022-03-23", acting_seller_id: "owner-1", amendment_reason: null },
    ];
    const eventRows = [
      {
        id: "pf_evt_open", owner_id: "owner-1", account_id: "pf_acct_1",
        event_type: "account_opened", event_origin: "interactive_user", created_by: "owner-1",
        ledger_sequence: 1, effective_date: "2022-03-23", recorded_at: "2022-03-23T00:00:00Z",
      },
      {
        id: "pf_evt_pay1", owner_id: "owner-1", account_id: "pf_acct_1",
        event_type: "payment_posted", event_origin: "manual_import", idempotency_key: "import-batch-1-row-1",
        ledger_sequence: 2, effective_date: "2022-04-23", recorded_at: "2022-04-23T00:00:00Z",
        amount_cents: paymentAmountCents,
        interest_paid_by_component_cents: allocation.interestPaidByComponentCents,
        principal_paid_by_component_cents: allocation.principalPaidByComponentCents,
        unallocated_cents: allocation.unallocatedCents,
        principal_remaining_by_component_cents: {
          ib: ib.originalPrincipalCents - (allocation.principalPaidByComponentCents.ib ?? 0),
          zi: zi.originalPrincipalCents - (allocation.principalPaidByComponentCents.zi ?? 0),
        },
        selected_extra_component_id: null,
      },
    ];

    const { events, componentVersions, accountTermsVersions } = mapEventRowsForReplay(eventRows, componentRows, termsRows);
    const result = replayEvents({ events, componentVersions, accountTermsVersions, asOfDate: "2022-05-01" });

    expect(result.remainingPrincipalByComponentCents.ib).toBe(ib.originalPrincipalCents - (allocation.principalPaidByComponentCents.ib ?? 0));
    expect(result.remainingPrincipalByComponentCents.zi).toBe(zi.originalPrincipalCents - (allocation.principalPaidByComponentCents.zi ?? 0));
    expect(result.closed).toBe(false);
  });
});

describe("numeric safety -- rejects any *_cents/rate_bps/ledger_sequence value outside JS's safe integer range", () => {
  it("rejects an unsafe-integer original_principal_cents on a component row", () => {
    const unsafe = Number.MAX_SAFE_INTEGER + 10;
    expect(() => mapComponentRow({ ...componentRow, original_principal_cents: unsafe })).toThrow(PersistedRowMappingError);
  });

  it("rejects a non-integer (fractional) cents value -- a bigint column should never carry a fraction", () => {
    expect(() => mapComponentRow({ ...componentRow, original_principal_cents: 4_500_000.5 })).toThrow(/must be an integer/);
  });

  it("rejects a malformed (string) cents value rather than silently coercing it", () => {
    expect(() => mapComponentRow({ ...componentRow, original_principal_cents: "4500000" })).toThrow(/must be an integer/);
  });

  it("rejects an unsafe-integer amount_cents on an event row", () => {
    const row = {
      id: "pf_evt_1", event_type: "payment_posted", ledger_sequence: 1, effective_date: "2022-04-23",
      amount_cents: Number.MAX_SAFE_INTEGER + 100,
      interest_paid_by_component_cents: {}, principal_paid_by_component_cents: {}, unallocated_cents: 0,
      principal_remaining_by_component_cents: {},
    };
    expect(() => mapEventRow(row)).toThrow(PersistedRowMappingError);
  });

  it("rejects an unsafe-integer ledger_sequence", () => {
    const row = { id: "pf_evt_1", event_type: "account_closed", ledger_sequence: Number.MAX_SAFE_INTEGER + 1, effective_date: "2022-04-23" };
    expect(() => mapEventRow(row)).toThrow(/ledger_sequence/);
  });

  it("accepts the largest safe integer as a valid boundary value", () => {
    const row = { id: "pf_evt_1", event_type: "account_closed", ledger_sequence: Number.MAX_SAFE_INTEGER, effective_date: "2022-04-23", closure_reason: "paid_in_full" };
    expect(() => mapEventRow(row)).not.toThrow();
  });

  it("passes null/undefined *_cents fields through unchanged -- most are legitimately null depending on event_type", () => {
    const row = { id: "pf_evt_1", event_type: "account_opened", ledger_sequence: 1, effective_date: "2022-03-23" };
    expect(() => mapEventRow(row)).not.toThrow();
  });

  it("preserves rate_bps and cent values exactly, with no floating-point arithmetic applied to them", () => {
    const mapped = mapComponentRow(componentRow);
    expect(mapped.rateBps).toBe(300);
    expect(mapped.originalPrincipalCents).toBe(4_500_000);
    // Object.is distinguishes -0 from 0 and catches any accidental numeric transformation.
    expect(Object.is(mapped.rateBps, 300)).toBe(true);
  });

  it("rejects an unsafe-integer value inside a jsonb per-component cents map", () => {
    const row = {
      id: "pf_evt_1", event_type: "payment_posted", ledger_sequence: 1, effective_date: "2022-04-23",
      amount_cents: 100,
      interest_paid_by_component_cents: { ib: Number.MAX_SAFE_INTEGER + 1 },
      principal_paid_by_component_cents: {}, unallocated_cents: 0,
      principal_remaining_by_component_cents: {},
    };
    expect(() => mapEventRow(row)).toThrow(PersistedRowMappingError);
  });
});

describe("no locale-dependent date or number parsing", () => {
  it("contains no Date/parseInt/parseFloat/Number(...) parsing calls anywhere in the module source", () => {
    const source = readFileSync(resolve(process.cwd(), "src/domains/private-financing/persistedRowMapping.js"), "utf8");
    expect(source).not.toContain("new Date(");
    expect(source).not.toContain("Date.parse(");
    expect(source).not.toContain("parseInt(");
    expect(source).not.toContain("parseFloat(");
    expect(source).not.toContain("Number(");
    expect(source).not.toContain("toLocaleString");
  });

  it("passes an ISO date string through byte-for-byte, never reformatting it", () => {
    const row = { id: "pf_evt_1", event_type: "account_closed", ledger_sequence: 1, effective_date: "2026-08-29", closure_reason: "paid_in_full" };
    expect(mapEventRow(row).effectiveDate).toBe("2026-08-29");
  });
});

describe("this module never trusts a stored balance over replay -- it cannot produce one", () => {
  it("mapEventRow's output never includes a running-balance or current-balance-shaped field", () => {
    const row = {
      id: "pf_evt_1", event_type: "payment_posted", ledger_sequence: 1, effective_date: "2022-04-23",
      amount_cents: 100,
      interest_paid_by_component_cents: {}, principal_paid_by_component_cents: { ib: 100 }, unallocated_cents: 0,
      principal_remaining_by_component_cents: { ib: 4_499_900, zi: 1_000_000 },
    };
    const mapped = mapEventRow(row);
    expect(mapped).not.toHaveProperty("runningBalanceCents");
    expect(mapped).not.toHaveProperty("currentBalanceCents");
    // The only balance-shaped field is principalRemainingByComponentCents, which is re-verified (not
    // trusted) by ledgerIntegrity.js the moment replayEvents.js folds this event -- see the round-trip
    // test above.
    expect(Object.keys(mapped)).toContain("principalRemainingByComponentCents");
  });

  it("a negative amount_cents (which the contract disallows for payment_posted) is caught by replay, not silently accepted here", () => {
    const row = {
      id: "pf_evt_1", owner_id: "owner-1", account_id: "pf_acct_1", event_type: "payment_posted",
      event_origin: "interactive_user", created_by: "owner-1", ledger_sequence: 2, effective_date: "2022-04-23",
      recorded_at: "2022-04-23T00:00:00Z", amount_cents: -100,
      interest_paid_by_component_cents: {}, principal_paid_by_component_cents: { ib: -100 }, unallocated_cents: 0,
      principal_remaining_by_component_cents: { ib: 0 },
    };
    // The mapping itself succeeds (a negative integer is still a safe integer) -- but feeding the result
    // into replayEvents (which re-validates every event through privateFinancingContracts.js before
    // folding) must reject it. This is the intended division of labor: this module guards numeric SAFETY,
    // contracts.js guards business-rule VALIDITY.
    const eventRows = [
      { id: "pf_evt_open", owner_id: "owner-1", account_id: "pf_acct_1", event_type: "account_opened", event_origin: "interactive_user", created_by: "owner-1", ledger_sequence: 1, effective_date: "2022-03-23", recorded_at: "2022-03-23T00:00:00Z" },
      row,
    ];
    const componentRows = [
      { owner_id: "owner-1", id: "comp_ib", account_id: "pf_acct_1", component_key: "ib", label: "IB", original_principal_cents: 100, rate_bps: 0, day_count_convention: "actual_365", scheduled_component_amount_cents: 100, allocation_priority: 1, effective_date: "2022-03-23", version_number: 1 },
    ];
    const termsRows = [
      { owner_id: "owner-1", id: "terms_1", account_id: "pf_acct_1", version_number: 1, payment_frequency: "monthly", first_payment_due_date: "2022-04-23", regular_scheduled_payment_amount_cents: 100, maturity_date: null, allocation_policy: "scheduled_component_order", extra_payment_allocation_policy: "highest_rate_first_extra", prepayment_policy: "allowed_without_penalty_does_not_advance_due_date", day_count_convention: "actual_365", effective_date: "2022-03-23", acting_seller_id: "owner-1", amendment_reason: null },
    ];
    const { events, componentVersions, accountTermsVersions } = mapEventRowsForReplay(eventRows, componentRows, termsRows);
    expect(() => replayEvents({ events, componentVersions, accountTermsVersions, asOfDate: "2022-05-01" })).toThrow(MalformedPrivateFinancingContractError);
  });
});
