const EMPTY_CASH_BUYER_FORM = Object.freeze({
  name: "",
  company_name: "",
  email: "",
  phone: "",
  cities: "",
  property_types: "",
  max_price: "",
  funding_type: "",
  notes: "",
});

function buildCashBuyerForm(row = {}) {
  return {
    name: row.name || "",
    company_name: row.company_name || "",
    email: row.email || "",
    phone: row.phone || "",
    cities: row.cities || "",
    property_types: row.property_types || "",
    max_price: row.max_price || "",
    funding_type: row.funding_type || "",
    notes: row.notes || "",
  };
}

function buildCashBuyerPayload(form) {
  return {
    name: form.name,
    company_name: form.company_name,
    email: form.email,
    phone: form.phone,
    cities: form.cities,
    property_types: form.property_types,
    max_price: form.max_price,
    funding_type: form.funding_type,
    notes: form.notes,
  };
}

export class InvestorCashBuyerApplication {
  constructor({ supabase } = {}) {
    this.supabase = supabase;
  }

  getInitialCashBuyerForm() {
    return { ...EMPTY_CASH_BUYER_FORM };
  }

  async createCashBuyer(form) {
    const { error } = await this.supabase.from("cash_buyers").insert([
      {
        ...buildCashBuyerPayload(form),
        is_active: true,
      },
    ]);

    if (error) {
      return {
        ok: false,
        message: error.message || "Error adding cash buyer",
        error,
      };
    }

    return {
      ok: true,
      submitted: true,
      message: "Cash buyer added",
    };
  }

  async loadCashBuyer(buyerId) {
    const { data, error } = await this.supabase
      .from("cash_buyers")
      .select("*")
      .eq("id", buyerId)
      .single();

    if (error || !data) {
      return {
        ok: false,
        message: error?.message || "Cash buyer not found",
        error,
      };
    }

    return {
      ok: true,
      form: buildCashBuyerForm(data),
    };
  }

  async updateCashBuyer({ buyerId, form }) {
    const { error } = await this.supabase
      .from("cash_buyers")
      .update(buildCashBuyerPayload(form))
      .eq("id", buyerId);

    if (error) {
      return {
        ok: false,
        message: error.message || "Error updating cash buyer",
        error,
      };
    }

    return {
      ok: true,
      redirectTo: "/investors/cash-buyers",
      message: "Cash buyer updated",
    };
  }

  async deleteCashBuyer(buyerId) {
    const { error } = await this.supabase
      .from("cash_buyers")
      .update({ is_active: false })
      .eq("id", buyerId);

    if (error) {
      return {
        ok: false,
        message: error.message || "Error removing cash buyer",
        error,
      };
    }

    return {
      ok: true,
      redirectTo: "/investors/cash-buyers",
      message: "Cash buyer removed",
    };
  }
}

Object.freeze(InvestorCashBuyerApplication);

