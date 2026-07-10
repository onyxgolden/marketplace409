const EMPTY_WHOLESALER_FORM = Object.freeze({
  name: "",
  companyName: "",
  contactType: "",
  countiesServed: "",
  city: "",
  serviceArea: "",
  phone: "",
  email: "",
  websiteUrl: "",
  facebookUrl: "",
  dealTypes: "",
  buyerTypes: "",
  notes: "",
  communityContact: false,
});

function buildWholesalerForm(row = {}) {
  return {
    name: row.name || "",
    companyName: row.company_name || "",
    contactType: row.contact_type || "",
    countiesServed: row.counties_served || "",
    city: row.city || "",
    serviceArea: row.service_area || "",
    phone: row.phone || "",
    email: row.email || "",
    websiteUrl: row.website_url || "",
    facebookUrl: row.facebook_url || "",
    dealTypes: row.deal_types || "",
    buyerTypes: row.buyer_types || "",
    notes: row.notes || "",
    communityContact: row.community_contact || false,
  };
}

function buildWholesalerPayload(form) {
  return {
    name: form.name,
    company_name: form.companyName,
    contact_type: form.contactType,
    counties_served: form.countiesServed,
    city: form.city,
    service_area: form.serviceArea,
    phone: form.phone,
    email: form.email,
    website_url: form.websiteUrl,
    facebook_url: form.facebookUrl,
    deal_types: form.dealTypes,
    buyer_types: form.buyerTypes,
    notes: form.notes,
    community_contact: form.communityContact,
  };
}

export class InvestorWholesalerApplication {
  constructor({ supabase } = {}) {
    this.supabase = supabase;
  }

  getInitialWholesalerForm() {
    return { ...EMPTY_WHOLESALER_FORM };
  }

  async createWholesaler(form) {
    const { error } = await this.supabase
      .from("investor_wholesalers")
      .insert([buildWholesalerPayload(form)]);

    if (error) {
      return {
        ok: false,
        message: error.message || "Error adding wholesaler contact",
        error,
      };
    }

    return {
      ok: true,
      redirectTo: "/investors/wholesalers",
      message: "Wholesaler contact added",
    };
  }

  async loadWholesaler(wholesalerId) {
    const { data, error } = await this.supabase
      .from("investor_wholesalers")
      .select("*")
      .eq("id", wholesalerId)
      .single();

    if (error || !data) {
      return {
        ok: false,
        redirectTo: "/investors/wholesalers",
        message: "Wholesaler contact not found",
        error,
      };
    }

    return {
      ok: true,
      form: buildWholesalerForm(data),
    };
  }

  async updateWholesaler({ wholesalerId, form }) {
    const { error } = await this.supabase
      .from("investor_wholesalers")
      .update(buildWholesalerPayload(form))
      .eq("id", wholesalerId);

    if (error) {
      return {
        ok: false,
        message: error.message || "Error updating wholesaler contact",
        error,
      };
    }

    return {
      ok: true,
      redirectTo: "/investors/wholesalers",
      message: "Wholesaler contact updated",
    };
  }

  async deleteWholesaler(wholesalerId) {
    const { error } = await this.supabase
      .from("investor_wholesalers")
      .delete()
      .eq("id", wholesalerId);

    if (error) {
      return {
        ok: false,
        message: error.message || "Error deleting wholesaler contact",
        error,
      };
    }

    return {
      ok: true,
      redirectTo: "/investors/wholesalers",
      message: "Wholesaler contact deleted",
    };
  }
}

Object.freeze(InvestorWholesalerApplication);
