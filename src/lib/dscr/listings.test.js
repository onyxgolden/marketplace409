import { describe, it, expect } from "vitest";
import {
  validateNmlsFormat,
  nmlsConsumerAccessUrl,
  isTermsStale,
  orderListingsNeutral,
  filterListings,
  STALENESS_THRESHOLD_DAYS,
} from "./listings.js";

describe("validateNmlsFormat", () => {
  it("accepts 5-8 digit numbers", () => {
    for (const n of ["12345", "123456", "1660690", "2453285", "12345678"]) {
      const r = validateNmlsFormat(n);
      expect(r.valid, n).toBe(true);
      expect(r.normalized).toBe(n);
    }
  });

  it("rejects non-digit characters", () => {
    expect(validateNmlsFormat("12A45").valid).toBe(false);
    expect(validateNmlsFormat("12-345").valid).toBe(false);
  });

  it("rejects too-short and too-long numbers", () => {
    expect(validateNmlsFormat("1234").valid).toBe(false);
    expect(validateNmlsFormat("123456789").valid).toBe(false);
  });

  it("rejects empty input", () => {
    expect(validateNmlsFormat("").valid).toBe(false);
    expect(validateNmlsFormat(null).valid).toBe(false);
  });

  it("trims whitespace", () => {
    const r = validateNmlsFormat("  1660690  ");
    expect(r.valid).toBe(true);
    expect(r.normalized).toBe("1660690");
  });
});

describe("nmlsConsumerAccessUrl", () => {
  it("builds a lookup URL", () => {
    expect(nmlsConsumerAccessUrl("1660690")).toBe(
      "https://www.nmlsconsumeraccess.org/EntityDetails.aspx/COMPANY/1660690"
    );
  });
});

describe("isTermsStale", () => {
  it("marks missing dates stale", () => {
    expect(isTermsStale(null)).toBe(true);
    expect(isTermsStale(undefined)).toBe(true);
  });

  it("marks old confirmations stale", () => {
    const old = new Date(
      Date.now() - (STALENESS_THRESHOLD_DAYS + 1) * 24 * 60 * 60 * 1000
    );
    expect(isTermsStale(old.toISOString())).toBe(true);
  });

  it("keeps fresh confirmations current", () => {
    const fresh = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    expect(isTermsStale(fresh.toISOString())).toBe(false);
  });
});

describe("orderListingsNeutral", () => {
  it("orders alphabetically, case-insensitive", () => {
    const out = orderListingsNeutral([
      { company_name: "Zebra Lending" },
      { company_name: "alpha capital" },
      { company_name: "Middle Bank" },
    ]);
    expect(out.map((l) => l.company_name)).toEqual([
      "alpha capital",
      "Middle Bank",
      "Zebra Lending",
    ]);
  });

  it("does not mutate the input", () => {
    const input = [{ company_name: "B" }, { company_name: "A" }];
    orderListingsNeutral(input);
    expect(input[0].company_name).toBe("B");
  });
});

describe("filterListings", () => {
  const fresh = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
  const base = {
    status: "published",
    last_provider_confirmed_at: fresh,
    states_served: ["TX", "FL"],
    min_loan_amount: 100000,
    max_loan_amount: 2000000,
    property_types: ["SFR", "2-4 unit"],
    transaction_types: ["purchase", "cash-out refinance"],
  };

  it("excludes stale listings by default", () => {
    const stale = { ...base, company_name: "Stale", last_provider_confirmed_at: null };
    const freshOne = { ...base, company_name: "Fresh" };
    const out = filterListings([stale, freshOne]);
    expect(out.map((l) => l.company_name)).toEqual(["Fresh"]);
  });

  it("excludes unpublished listings", () => {
    const draft = { ...base, company_name: "Draft", status: "pending_review" };
    expect(filterListings([draft])).toHaveLength(0);
  });

  it("filters by state (case-insensitive)", () => {
    const out = filterListings([{ ...base, company_name: "A" }], { state: "tx" });
    expect(out).toHaveLength(1);
    expect(filterListings([{ ...base, company_name: "A" }], { state: "CA" })).toHaveLength(0);
  });

  it("filters by loan size overlap", () => {
    const l = { ...base, company_name: "A" };
    expect(filterListings([l], { minLoan: 500000 })).toHaveLength(1);
    expect(filterListings([l], { minLoan: 3000000 })).toHaveLength(0);
    expect(filterListings([l], { maxLoan: 50000 })).toHaveLength(0);
  });

  it("filters by property and transaction type", () => {
    const l = { ...base, company_name: "A" };
    expect(filterListings([l], { propertyType: "SFR" })).toHaveLength(1);
    expect(filterListings([l], { propertyType: "5+ unit" })).toHaveLength(0);
    expect(filterListings([l], { transactionType: "purchase" })).toHaveLength(1);
    expect(filterListings([l], { transactionType: "rate-term refinance" })).toHaveLength(0);
  });
});
