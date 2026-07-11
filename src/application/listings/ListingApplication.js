const EMPTY_LISTING_FORM = Object.freeze({
  title: "",
  description: "",
  price: "",
  category: "",
  city: "",
  sellerName: "",
  sellerEmail: "",
  sellerPhone: "",
  imageUrl: "",
});

function buildListingForm(row = {}) {
  return {
    title: row.title || "",
    description: row.description || "",
    price: row.price || "",
    category: row.category || "",
    city: row.city || "",
    sellerName: row.seller_name || "",
    sellerEmail: row.seller_email || "",
    sellerPhone: row.seller_phone || "",
    imageUrl: row.image_url || "",
  };
}

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

function buildListingUpdatePayload({ form, imageUrl }) {
  return {
    title: form.title,
    description: form.description,
    price: form.price,
    category: form.category,
    city: form.city,
    seller_name: form.sellerName,
    seller_email: form.sellerEmail,
    seller_phone: form.sellerPhone,
    image_url: imageUrl,
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

  async loadListing(listingId) {
    const { data, error } = await this.supabase
      .from("listings")
      .select("*")
      .eq("id", listingId)
      .single();

    if (error || !data) {
      return {
        ok: false,
        redirectTo: "/my-listings",
        message: "Listing not found.",
        error,
      };
    }

    return {
      ok: true,
      form: buildListingForm(data),
    };
  }

  async updateListing({ listingId, form, newImageFile }) {
    let finalImageUrl = form.imageUrl;

    try {
      finalImageUrl = await this.imageUploader({
        file: newImageFile,
        currentImageUrl: form.imageUrl,
        folder: "listings",
        prefix: "listing",
        recordId: listingId,
      });
    } catch (error) {
      return buildUploadFailure(error);
    }

    if (newImageFile && finalImageUrl === form.imageUrl) {
      return buildUploadFailure(
        new Error("Error uploading listing image"),
      );
    }

    const { error } = await this.supabase
      .from("listings")
      .update(
        buildListingUpdatePayload({
          form,
          imageUrl: finalImageUrl,
        }),
      )
      .eq("id", listingId);

    if (error) {
      return {
        ok: false,
        message: error.message || "Error saving listing.",
        error,
      };
    }

    return {
      ok: true,
      redirectTo: `/listing/${listingId}`,
      message: "Listing updated.",
    };
  }

  async deleteListing({ listingId, ownerId, confirmed }) {
    const {
      data: { user },
    } = await this.supabase.auth.getUser();

    if (!user) {
      return {
        ok: false,
        redirectTo: "/auth",
        message: "Please sign in first.",
        requiresAuthentication: true,
      };
    }

    if (user.id !== ownerId) {
      return {
        ok: false,
        message: "You can only delete your own listings.",
        unauthorized: true,
      };
    }

    if (!confirmed) {
      return {
        ok: false,
        cancelled: true,
      };
    }

    const { error } = await this.supabase
      .from("listings")
      .delete()
      .eq("id", listingId)
      .eq("user_id", user.id);

    if (error) {
      return {
        ok: false,
        message: error.message || "Error deleting listing",
        error,
      };
    }

    return {
      ok: true,
      redirectTo: "/browse",
      message: "Listing deleted",
    };
  }

  async toggleListingSold({ listingId, ownerId, isSold }) {
    const {
      data: { user },
    } = await this.supabase.auth.getUser();

    if (!user) {
      return {
        ok: false,
        redirectTo: "/auth",
        message: "Please sign in first.",
        requiresAuthentication: true,
      };
    }

    if (user.id !== ownerId) {
      return {
        ok: false,
        message: "You can only update your own listings.",
        unauthorized: true,
      };
    }

    const nextIsSold = !isSold;

    const { error } = await this.supabase
      .from("listings")
      .update({
        is_sold: nextIsSold,
      })
      .eq("id", listingId)
      .eq("user_id", user.id);

    if (error) {
      return {
        ok: false,
        message: error.message || "Error updating listing.",
        error,
      };
    }

    return {
      ok: true,
      reload: true,
      isSold: nextIsSold,
    };
  }
}

Object.freeze(ListingApplication);
