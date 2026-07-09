const EMPTY_PROPERTY_FORM = Object.freeze({
  address: "",
  city: "",
  county: "",
  asking_price: "",
  arv: "",
  rehab_cost: "",
  estimated_rent: "",
  bedrooms: "",
  bathrooms: "",
  sqft: "",
  lot_size: "",
  occupancy: "",
  property_type: "",
  summary: "",
  image_url: "",
});

function normalizeNullableValue(value) {
  return value || null;
}

function buildPropertyForm(row = {}) {
  return {
    address: row.address || "",
    city: row.city || "",
    county: row.county || "",
    asking_price: row.asking_price || "",
    arv: row.arv || "",
    rehab_cost: row.rehab_cost || "",
    estimated_rent: row.estimated_rent || "",
    bedrooms: row.bedrooms || "",
    bathrooms: row.bathrooms || "",
    sqft: row.sqft || "",
    lot_size: row.lot_size || "",
    occupancy: row.occupancy || "",
    property_type: row.property_type || "",
    summary: row.summary || "",
    image_url: row.image_url || "",
  };
}

function buildCreatePropertyPayload({ form, imageUrl, userId }) {
  return {
    address: form.address,
    city: form.city,
    county: form.county,
    asking_price: normalizeNullableValue(form.asking_price),
    arv: normalizeNullableValue(form.arv),
    rehab_cost: normalizeNullableValue(form.rehab_cost),
    estimated_rent: normalizeNullableValue(form.estimated_rent),
    bedrooms: normalizeNullableValue(form.bedrooms),
    bathrooms: normalizeNullableValue(form.bathrooms),
    sqft: normalizeNullableValue(form.sqft),
    lot_size: form.lot_size,
    occupancy: form.occupancy,
    property_type: form.property_type,
    summary: form.summary,
    image_url: imageUrl,
    created_by: userId,
  };
}

function buildUpdatePropertyPayload({ form, imageUrl }) {
  return {
    ...form,
    image_url: imageUrl,
    asking_price: normalizeNullableValue(form.asking_price),
    arv: normalizeNullableValue(form.arv),
    rehab_cost: normalizeNullableValue(form.rehab_cost),
    estimated_rent: normalizeNullableValue(form.estimated_rent),
    bedrooms: normalizeNullableValue(form.bedrooms),
    bathrooms: normalizeNullableValue(form.bathrooms),
    sqft: normalizeNullableValue(form.sqft),
  };
}

async function uploadCreateImage({ supabase, image }) {
  if (!image) {
    return "";
  }

  const fileExt = image.name.split(".").pop();
  const fileName = `${Date.now()}-investor-property.${fileExt}`;

  const { error: uploadError } = await supabase.storage
    .from("listing-images")
    .upload(fileName, image, {
      contentType: image.type,
      upsert: false,
    });

  if (uploadError) {
    throw uploadError;
  }

  const { data } = supabase.storage
    .from("listing-images")
    .getPublicUrl(fileName);

  return data.publicUrl;
}

export class InvestorPropertyApplication {
  constructor({ supabase, imageUploader } = {}) {
    this.supabase = supabase;
    this.imageUploader = imageUploader;
  }

  getInitialPropertyForm() {
    return { ...EMPTY_PROPERTY_FORM };
  }

  async createProperty({ form, image }) {
    const {
      data: { user },
    } = await this.supabase.auth.getUser();

    if (!user) {
      return {
        ok: false,
        reason: "authentication_required",
        message:
          "Please create a free account before posting an investment property.",
      };
    }

    const imageUrl = await uploadCreateImage({
      supabase: this.supabase,
      image,
    });

    const { error } = await this.supabase.from("investor_properties").insert([
      buildCreatePropertyPayload({
        form,
        imageUrl,
        userId: user.id,
      }),
    ]);

    if (error) {
      return {
        ok: false,
        reason: "create_failed",
        message: error.message || "Error posting investment property",
        error,
      };
    }

    return {
      ok: true,
      redirectTo: "/investors/properties",
      message: "Investment property posted!",
    };
  }

  async loadProperty(propertyId) {
    const { data, error } = await this.supabase
      .from("investor_properties")
      .select("*")
      .eq("id", propertyId)
      .single();

    if (error) {
      return {
        ok: false,
        message: error.message,
        error,
      };
    }

    return {
      ok: true,
      form: buildPropertyForm(data),
    };
  }

  async updateProperty({ propertyId, form, newImage }) {
    const imageUrl = await this.imageUploader({
      file: newImage,
      currentImageUrl: form.image_url,
      folder: "investor-properties",
      prefix: "investor-property",
      recordId: propertyId,
    });

    const { error } = await this.supabase
      .from("investor_properties")
      .update(
        buildUpdatePropertyPayload({
          form,
          imageUrl,
        }),
      )
      .eq("id", propertyId);

    if (error) {
      return {
        ok: false,
        message: error.message,
        error,
      };
    }

    return {
      ok: true,
      redirectTo: "/investors/properties",
    };
  }

  async deleteProperty(propertyId) {
    const { error } = await this.supabase
      .from("investor_properties")
      .delete()
      .eq("id", propertyId);

    if (error) {
      return {
        ok: false,
        message: error.message,
        error,
      };
    }

    return {
      ok: true,
      redirectTo: "/investors/properties",
    };
  }
}

Object.freeze(InvestorPropertyApplication);
