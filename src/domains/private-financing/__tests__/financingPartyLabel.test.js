import { describe, expect, it } from "vitest";
import { financingPartyLabel } from "../financingPartyLabel.js";

describe("financingPartyLabel", () => {
  it("returns 'Seller' for seller_financing", () => {
    expect(financingPartyLabel("seller_financing")).toBe("Seller");
  });

  it("returns 'Lender' for personal_loan", () => {
    expect(financingPartyLabel("personal_loan")).toBe("Lender");
  });

  it("falls back to 'Seller' for an unrecognized or missing product, rather than throwing", () => {
    expect(financingPartyLabel("some_future_type")).toBe("Seller");
    expect(financingPartyLabel(undefined)).toBe("Seller");
    expect(financingPartyLabel(null)).toBe("Seller");
  });
});
