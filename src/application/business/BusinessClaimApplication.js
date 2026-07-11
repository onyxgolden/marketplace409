const EMPTY_BUSINESS_CLAIM_FORM = Object.freeze({
  claimant_name: "",
  title: "",
  email: "",
  phone: "",
  website: "",
  facebook_url: "",
  notes: "",
  certified: false,
});

function buildBusinessClaimPayload({ businessId, businessName, form }) {
  return {
    business_id: businessId,
    business_name: businessName,
    claimant_name: form.claimant_name,
    title: form.title,
    email: form.email,
    phone: form.phone,
    website: form.website,
    facebook_url: form.facebook_url,
    notes: form.notes,
    certified: form.certified,
    status: "pending",
  };
}

function normalizeError(error, fallbackMessage) {
  return {
    ok: false,
    message: error?.message || fallbackMessage,
    error,
  };
}

export class BusinessClaimApplication {
  constructor({ service } = {}) {
    if (!service) {
      throw new Error("BusinessClaimApplication requires a service");
    }

    this.service = service;
  }

  getInitialBusinessClaimForm() {
    return {
      ...EMPTY_BUSINESS_CLAIM_FORM,
    };
  }

  async submitClaim({ businessId, businessName, form }) {
    if (!form.certified) {
      return {
        ok: false,
        message:
          "You must certify that you are authorized to represent this business.",
      };
    }

    try {
      const claim = await this.service.submitClaim(
        buildBusinessClaimPayload({
          businessId,
          businessName,
          form,
        }),
      );

      return {
        ok: true,
        claim,
        message: "Claim request submitted.",
      };
    } catch (error) {
      return normalizeError(error, "Failed to submit claim");
    }
  }

  async loadClaims() {
    try {
      const claims = await this.service.getAllClaims();

      return {
        ok: true,
        claims: [...(claims || [])],
      };
    } catch (error) {
      return {
        ...normalizeError(error, "Failed to load business claims"),
        claims: [],
      };
    }
  }

  async approveClaim(claim) {
    try {
      await this.service.approveClaim(claim);

      return {
        ok: true,
        message: "Business claim approved.",
        refresh: true,
      };
    } catch (error) {
      return normalizeError(error, "Failed to approve business claim");
    }
  }

  async rejectClaim(claimId) {
    try {
      await this.service.rejectClaim(claimId);

      return {
        ok: true,
        message: "Business claim rejected.",
        refresh: true,
      };
    } catch (error) {
      return normalizeError(error, "Failed to reject business claim");
    }
  }
}

Object.freeze(BusinessClaimApplication);
