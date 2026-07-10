const EMPTY_BUSINESS_EDIT_FORM = Object.freeze({
  name: "",
  category: "",
  city: "",
  phone: "",
  websiteUrl: "",
  facebookUrl: "",
  description: "",
  trustTags: Object.freeze([]),
  imageUrl: "",
});

function buildBusinessEditForm(row = {}) {
  return {
    name: row.name || "",
    category: row.category || "",
    city: row.city || "",
    phone: row.phone || "",
    websiteUrl: row.website_url || "",
    facebookUrl: row.facebook_url || "",
    description: row.description || "",
    trustTags: [...(row.trust_tags || [])],
    imageUrl: row.image_url || "",
  };
}

function buildBusinessUpdatePayload({ form, imageUrl }) {
  return {
    name: form.name,
    category: form.category,
    city: form.city,
    phone: form.phone,
    website_url: form.websiteUrl,
    facebook_url: form.facebookUrl,
    description: form.description,
    trust_tags: [...form.trustTags],
    image_url: imageUrl,
  };
}

export class BusinessEditApplication {
  constructor({ supabase, imageUploader } = {}) {
    this.supabase = supabase;
    this.imageUploader = imageUploader;
  }

  getInitialBusinessEditForm() {
    return {
      ...EMPTY_BUSINESS_EDIT_FORM,
      trustTags: [],
    };
  }

  async loadBusiness(businessId) {
    const { data, error } = await this.supabase
      .from("businesses")
      .select("*")
      .eq("id", businessId)
      .single();

    if (error || !data) {
      return {
        ok: false,
        redirectTo: "/businesses",
        message: "Business not found.",
        error,
      };
    }

    return {
      ok: true,
      form: buildBusinessEditForm(data),
    };
  }

  async updateBusiness({ businessId, form, newImageFile }) {
    const finalImageUrl = await this.imageUploader({
      file: newImageFile,
      currentImageUrl: form.imageUrl,
      folder: "businesses",
      prefix: "business",
      recordId: businessId,
    });

    const { error } = await this.supabase
      .from("businesses")
      .update(
        buildBusinessUpdatePayload({
          form,
          imageUrl: finalImageUrl,
        }),
      )
      .eq("id", businessId);

    if (error) {
      return {
        ok: false,
        message: "Error updating business",
        error,
      };
    }

    return {
      ok: true,
      redirectTo: "/businesses",
      message: "Business updated!",
    };
  }
}

Object.freeze(BusinessEditApplication);
