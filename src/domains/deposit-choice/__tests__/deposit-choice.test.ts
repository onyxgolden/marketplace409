import { describe, expect, it } from "vitest";
import { createLeaseDepositChoice } from "../deposit-choice.types";

describe("lease deposit choice validation", () => {
  it("accepts the traditional security deposit choice without a product reference", () => {
    const choice = createLeaseDepositChoice({ leaseId: "lease_1", choice: "traditional_security_deposit", productReference: null });
    expect(choice.choice).toBe("traditional_security_deposit");
    expect(choice.productReference).toBeNull();
  });

  it("requires a product reference for the deposit-insurance product choice", () => {
    expect(() => createLeaseDepositChoice({ leaseId: "lease_1", choice: "deposit_insurance_product", productReference: null })).toThrow(
      "must name the product reference",
    );
    expect(() => createLeaseDepositChoice({ leaseId: "lease_1", choice: "deposit_insurance_product", productReference: "  " })).toThrow(
      "must name the product reference",
    );
  });

  it("accepts the deposit-insurance product choice with a reference (record-only, not a binding)", () => {
    const choice = createLeaseDepositChoice({ leaseId: "lease_1", choice: "deposit_insurance_product", productReference: " Obligo-style surety reference " });
    expect(choice.choice).toBe("deposit_insurance_product");
    expect(choice.productReference).toBe("Obligo-style surety reference");
  });

  it("rejects unknown choices and missing leases", () => {
    expect(() => createLeaseDepositChoice({ leaseId: "lease_1", choice: "bitcoin" as never, productReference: null })).toThrow("supported choice");
    expect(() => createLeaseDepositChoice({ leaseId: "  ", choice: "traditional_security_deposit", productReference: null })).toThrow("lease id");
  });

  it("returns a frozen record", () => {
    expect(Object.isFrozen(createLeaseDepositChoice({ leaseId: "lease_1", choice: "traditional_security_deposit", productReference: null }))).toBe(true);
  });
});
