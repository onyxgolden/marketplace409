const EMPTY_BUSINESS_CREATE_FORM = Object.freeze({
  name: "",
  category: "",
  city: "",
  phone: "",
  websiteUrl: "",
  facebookUrl: "",
  description: "",
  trustTags: Object.freeze([]),
});

function buildBusinessCreatePayload({ form, imageUrl }) {
  return {
    name: form.name.trim(),
    category: form.category.trim(),
    city: form.city.trim(),
    phone: form.phone.trim(),
    website_url: form.websiteUrl.trim(),
    facebook_url: form.facebookUrl.trim(),
    description: form.description.trim(),
    trust_tags: [...form.trustTags],
    image_url: imageUrl,
  };
}

export class BusinessCreateApplication {
  constructor({ supabase, imageUploader } = {}) {
    this.supabase = supabase;
    this.imageUploader = imageUploader;
  }

  getInitialBusinessCreateForm() {
    return { ...EMPTY_BUSINESS_CREATE_FORM, trustTags: [] };
  }

  async createBusiness({ form, imageFile }) {
    const imageUrl = await this.imageUploader({
      file: imageFile,
      currentImageUrl: "",
      folder: "businesses",
      prefix: "business",
      recordId: "new",
    });

    const { error } = await this.supabase
      .from("businesses")
      .insert([buildBusinessCreatePayload({ form, imageUrl })]);

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
