export class BusinessDeleteApplication {
  constructor({ supabase } = {}) {
    this.supabase = supabase;
  }

  async deleteBusiness({ businessId }) {
    const { error } = await this.supabase
      .from("businesses")
      .delete()
      .eq("id", businessId);

    if (error) {
      return {
        ok: false,
        message: error.message || "Error deleting business",
        error,
      };
    }

    return {
      ok: true,
      reload: true,
      message: "Business deleted",
    };
  }
}

Object.freeze(BusinessDeleteApplication);
