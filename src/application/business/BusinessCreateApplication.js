const EMPTY_BUSINESS_CREATE_FORM = Object.freeze({
  name: "",
  address: "",
});

function buildBusinessCreatePayload(form) {
  return {
    name: form.name,
    address: form.address,
  };
}

export class BusinessCreateApplication {
  constructor({ supabase } = {}) {
    this.supabase = supabase;
  }

  getInitialBusinessCreateForm() {
    return { ...EMPTY_BUSINESS_CREATE_FORM };
  }

  async createBusiness(form) {
    const { error } = await this.supabase
      .from("businesses")
      .insert([buildBusinessCreatePayload(form)]);

    if (error) {
      return {
        ok: false,
        message: error.message || "Failed to create business",
        error,
      };
    }

    return {
      ok: true,
      redirectTo: "/businesses",
      message: "Business created!",
    };
  }
}

Object.freeze(BusinessCreateApplication);
