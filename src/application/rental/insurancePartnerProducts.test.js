import { afterEach, describe, expect, it, vi } from "vitest";
import {
  INSURANCE_PARTNER_APPROVAL_CHECKLIST,
  INSURANCE_PARTNER_GATE_MESSAGE,
  getInsurancePartnerStatus,
  requestInsurancePartnerQuote,
} from "./insurancePartnerProducts";

// R24 — the insurance partner layer is a design-only stub under Jason's
// build-spend doctrine: no paid signups, no partner bindings, no network
// calls, no real quotes. These tests pin the gate closed.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("insurance partner products (hard gate)", () => {
  it("always reports not connected", () => {
    const status = getInsurancePartnerStatus();
    expect(status.connected).toBe(false);
    expect(status.provider).toBeNull();
    expect(status.message).toContain("not connected");
    expect(Object.isFrozen(status)).toBe(true);
  });

  it("lists exactly the three partner product lanes", () => {
    const status = getInsurancePartnerStatus();
    expect([...status.products]).toEqual(["renters_insurance", "deposit_insurance", "pet_liability"]);
  });

  it("refuses quotes without any network call", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const refused = requestInsurancePartnerQuote({ product: "renters_insurance", leaseId: "lease_1" });
    expect(refused.ok).toBe(false);
    expect(refused.quoted).toBe(false);
    expect(refused.error).toBe(INSURANCE_PARTNER_GATE_MESSAGE);
    expect(refused.product).toBe("renters_insurance");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("documents the approval checklist Jason must clear before go-live", () => {
    expect(INSURANCE_PARTNER_APPROVAL_CHECKLIST.length).toBeGreaterThanOrEqual(4);
    const text = INSURANCE_PARTNER_APPROVAL_CHECKLIST.join(" ");
    expect(text).toContain("Partner choice");
    expect(text).toContain("who pays");
    expect(text).toContain("Secure Vault");
  });
});
