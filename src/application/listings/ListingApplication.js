const EMPTY_LISTING_FORM = Object.freeze({
  title: "",
  description: "",
  price: "",
  category: "",
  city: "",
  sellerName: "",
  sellerEmail: "",
  sellerPhone: "",
});

function buildListingCreatePayload({
  form,
  imageUrls,
  userId,
}) {
  return {
    title: form.title,
    description: form.description,
    price: form.price,
    category: form.category,
    city: form.city,
    image_url: imageUrls[0] || "",
    image_urls: [...imageUrls],
    seller_name: form.sellerName,
    seller_email: form.sellerEmail,
    seller_phone: form.sellerPhone,
    user_id: userId,
  };
}

function buildUploadFailure(error) {
  return {
    ok: false,
    message: error?.message || "Error uploading listing image",
    error,
  };
}

export class ListingApplication {
  constructor({ supabase, imageUploader } = {}) {
    this.supabase = supabase;
    this.imageUploader = imageUploader;
  }

  getInitialListingForm() {
    return { ...EMPTY_LISTING_FORM };
  }

  async createListing({ form, imageFiles = [] }) {
    const {
      data: { user },
    } = await this.supabase.auth.getUser();

    if (!user) {
      return {
        ok: false,
        redirectTo: "/auth",
        message:
          "You can browse listings as a guest, but you need a free account to post.",
        requiresAuthentication: true,
      };
    }

    const imageUrls = [];

    try {
      for (const imageFile of imageFiles) {
        const imageUrl = await this.imageUploader({
          file: imageFile,
          currentImageUrl: "",
          folder: "listings",
          prefix: "listing",
          recordId: "new",
        });

        if (!imageUrl) {
          return buildUploadFailure(
            new Error("Error uploading listing image"),
          );
        }

        imageUrls.push(imageUrl);
      }
    } catch (error) {
      return buildUploadFailure(error);
    }

    const { data, error } = await this.supabase
      .from("listings")
      .insert([
        buildListingCreatePayload({
          form,
          imageUrls,
          userId: user.id,
        }),
      ])
      .select()
      .single();

    if (error || !data) {
      return {
        ok: false,
        message: error?.message || "Error posting listing",
        error,
      };
    }

    return {
      ok: true,
      redirectTo: `/listing/${data.id}`,
      message: "Listing posted successfully!",
      listingId: data.id,
    };
  }
}

Object.freeze(ListingApplication);
