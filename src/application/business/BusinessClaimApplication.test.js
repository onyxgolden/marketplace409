import { describe, expect, it, vi } from "vitest";

import { BusinessClaimApplication } from "./BusinessClaimApplication";

function createServiceMock({
  submittedClaim = { id: "claim-1" },
  claims = [],
  submitError = null,
  loadError = null,
  approveError = null,
  rejectError = null,
} = {}) {
  const submitClaim = vi.fn(async () => {
    if (submitError) {
      throw submitError;
    }

    return submittedClaim;
  });

  const getAllClaims = vi.fn(async () => {
    if (loadError) {
      throw loadError;
    }

    return claims;
  });

  const approveClaim = vi.fn(async () => {
    if (approveError) {
      throw approveError;
    }
  });

  const rejectClaim = vi.fn(async () => {
    if (rejectError) {
      throw rejectError;
    }
  });

  return {
    submitClaim,
    getAllClaims,
    approveClaim,
    rejectClaim,
  };
}

describe("BusinessClaimApplication", () => {
  it("creates an initial business claim form", () => {
    const application = new BusinessClaimApplication({
      service: createServiceMock(),
    });

    expect(application.getInitialBusinessClaimForm()).toEqual({
      claimant_name: "",
      title: "",
      email: "",
      phone: "",
      website: "",
      facebook_url: "",
      notes: "",
      certified: false,
    });
  });

  it("creates independent initial forms", () => {
    const application = new BusinessClaimApplication({
      service: createServiceMock(),
    });

    const firstForm = application.getInitialBusinessClaimForm();
    const secondForm = application.getInitialBusinessClaimForm();

    firstForm.claimant_name = "Jason Morgan";
    firstForm.certified = true;

    expect(secondForm).toEqual({
      claimant_name: "",
      title: "",
      email: "",
      phone: "",
      website: "",
      facebook_url: "",
      notes: "",
      certified: false,
    });
  });

  it("rejects uncertified claim submissions before persistence", async () => {
    const service = createServiceMock();
    const application = new BusinessClaimApplication({ service });

    const result = await application.submitClaim({
      businessId: "business-1",
      businessName: "409 Roofing",
      form: application.getInitialBusinessClaimForm(),
    });

    expect(service.submitClaim).not.toHaveBeenCalled();

    expect(result).toEqual({
      ok: false,
      message:
        "You must certify that you are authorized to represent this business.",
    });
  });

  it("submits a normalized business claim payload", async () => {
    const submittedClaim = {
      id: "claim-1",
      status: "pending",
    };

    const service = createServiceMock({ submittedClaim });
    const application = new BusinessClaimApplication({ service });

    const result = await application.submitClaim({
      businessId: "business-1",
      businessName: "409 Roofing",
      form: {
        claimant_name: "Jason Morgan",
        title: "Owner",
        email: "jason@example.com",
        phone: "409-555-0000",
        website: "https://example.com",
        facebook_url: "https://facebook.com/example",
        notes: "Please verify ownership.",
        certified: true,
      },
    });

    expect(service.submitClaim).toHaveBeenCalledWith({
      business_id: "business-1",
      business_name: "409 Roofing",
      claimant_name: "Jason Morgan",
      title: "Owner",
      email: "jason@example.com",
      phone: "409-555-0000",
      website: "https://example.com",
      facebook_url: "https://facebook.com/example",
      notes: "Please verify ownership.",
      certified: true,
      status: "pending",
    });

    expect(result).toEqual({
      ok: true,
      claim: submittedClaim,
      message: "Claim request submitted.",
    });
  });

  it("normalizes claim submission failures", async () => {
    const error = {
      message: "Claim insert failed",
    };

    const application = new BusinessClaimApplication({
      service: createServiceMock({ submitError: error }),
    });

    const result = await application.submitClaim({
      businessId: "business-1",
      businessName: "409 Roofing",
      form: {
        ...application.getInitialBusinessClaimForm(),
        certified: true,
      },
    });

    expect(result).toEqual({
      ok: false,
      message: "Claim insert failed",
      error,
    });
  });

  it("loads independent claim collections", async () => {
    const claims = [
      {
        id: "claim-1",
        business_name: "409 Roofing",
      },
    ];

    const application = new BusinessClaimApplication({
      service: createServiceMock({ claims }),
    });

    const result = await application.loadClaims();

    expect(result).toEqual({
      ok: true,
      claims,
    });

    expect(result.claims).not.toBe(claims);
  });

  it("normalizes claim loading failures", async () => {
    const error = {
      message: "Claim load failed",
    };

    const application = new BusinessClaimApplication({
      service: createServiceMock({ loadError: error }),
    });

    const result = await application.loadClaims();

    expect(result).toEqual({
      ok: false,
      message: "Claim load failed",
      error,
      claims: [],
    });
  });

  it("approves a claim and requests a refresh", async () => {
    const service = createServiceMock();
    const application = new BusinessClaimApplication({ service });

    const claim = {
      id: "claim-1",
      business_id: "business-1",
      claimant_name: "Jason Morgan",
    };

    const result = await application.approveClaim(claim);

    expect(service.approveClaim).toHaveBeenCalledWith(claim);

    expect(result).toEqual({
      ok: true,
      message: "Business claim approved.",
      refresh: true,
    });
  });

  it("normalizes approval failures", async () => {
    const error = {
      message: "Approval failed",
    };

    const application = new BusinessClaimApplication({
      service: createServiceMock({ approveError: error }),
    });

    const result = await application.approveClaim({
      id: "claim-1",
    });

    expect(result).toEqual({
      ok: false,
      message: "Approval failed",
      error,
    });
  });

  it("rejects a claim and requests a refresh", async () => {
    const service = createServiceMock();
    const application = new BusinessClaimApplication({ service });

    const result = await application.rejectClaim("claim-1");

    expect(service.rejectClaim).toHaveBeenCalledWith("claim-1");

    expect(result).toEqual({
      ok: true,
      message: "Business claim rejected.",
      refresh: true,
    });
  });

  it("normalizes rejection failures", async () => {
    const error = {
      message: "Rejection failed",
    };

    const application = new BusinessClaimApplication({
      service: createServiceMock({ rejectError: error }),
    });

    const result = await application.rejectClaim("claim-1");

    expect(result).toEqual({
      ok: false,
      message: "Rejection failed",
      error,
    });
  });
});
