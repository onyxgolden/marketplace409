const EMPTY_PET_FORM = Object.freeze({
  petName: "",
  petType: "",
  postType: "",
  petOfWeekEligible: false,
  description: "",
  contactName: "",
  contactPhone: "",
  contactEmail: "",
  city: "",
  imageUrl: "",
});

function buildPetForm(row = {}) {
  return {
    petName: row.pet_name || "",
    petType: row.pet_type || "",
    postType: row.post_type || "",
    petOfWeekEligible: row.pet_of_week_eligible || false,
    description: row.description || "",
    contactName: row.contact_name || "",
    contactPhone: row.contact_phone || "",
    contactEmail: row.contact_email || "",
    city: row.city || "",
    imageUrl: row.image_url || "",
  };
}

function buildPetCreatePayload({ form, imageUrl }) {
  return {
    pet_name: form.petName,
    pet_type: form.petType,
    post_type: form.postType,
    description: form.description,
    image_url: imageUrl,
    contact_name: form.contactName,
    contact_phone: form.contactPhone,
    contact_email: form.contactEmail,
    city: form.city,
    votes: 0,
    pet_of_week_eligible: form.petOfWeekEligible,
  };
}

function buildPetUpdatePayload({ form, imageUrl }) {
  return {
    pet_name: form.petName,
    pet_type: form.petType,
    post_type: form.postType,
    pet_of_week_eligible: form.petOfWeekEligible,
    description: form.description,
    contact_name: form.contactName,
    contact_phone: form.contactPhone,
    contact_email: form.contactEmail,
    city: form.city,
    image_url: imageUrl,
  };
}

function buildUploadFailure(error) {
  return {
    ok: false,
    message: error?.message || "Error uploading pet image",
    error,
  };
}

export class PetApplication {
  constructor({ supabase, imageUploader } = {}) {
    this.supabase = supabase;
    this.imageUploader = imageUploader;
  }

  getInitialPetForm() {
    return { ...EMPTY_PET_FORM };
  }

  async createPet({ form, imageFile }) {
    const {
      data: { user },
    } = await this.supabase.auth.getUser();

    if (!user) {
      return {
        ok: false,
        redirectTo: "/auth",
        message: "Please create a free account before posting a pet.",
        requiresAuthentication: true,
      };
    }

    let imageUrl = "";

    try {
      imageUrl = await this.imageUploader({
        file: imageFile,
        currentImageUrl: "",
        folder: "pets",
        prefix: "pet",
        recordId: "new",
      });
    } catch (error) {
      return buildUploadFailure(error);
    }

    if (imageFile && !imageUrl) {
      return buildUploadFailure(
        new Error("Error uploading pet image"),
      );
    }

    const { error } = await this.supabase
      .from("pets")
      .insert([
        buildPetCreatePayload({
          form,
          imageUrl,
        }),
      ]);

    if (error) {
      return {
        ok: false,
        message: error.message || "Error adding pet post",
        error,
      };
    }

    return {
      ok: true,
      redirectTo: "/pets",
      message: "Pet post added!",
    };
  }

  async loadPet(petId) {
    const { data, error } = await this.supabase
      .from("pets")
      .select("*")
      .eq("id", petId)
      .single();

    if (error || !data) {
      return {
        ok: false,
        redirectTo: "/pets",
        message: "Pet post not found.",
        error,
      };
    }

    return {
      ok: true,
      form: buildPetForm(data),
    };
  }

  async updatePet({ petId, form, imageFile }) {
    let imageUrl = form.imageUrl;

    try {
      imageUrl = await this.imageUploader({
        file: imageFile,
        currentImageUrl: form.imageUrl,
        folder: "pets",
        prefix: "pet",
        recordId: petId,
      });
    } catch (error) {
      return buildUploadFailure(error);
    }

    if (imageFile && imageUrl === form.imageUrl) {
      return buildUploadFailure(
        new Error("Error uploading pet image"),
      );
    }

    const { error } = await this.supabase
      .from("pets")
      .update(
        buildPetUpdatePayload({
          form,
          imageUrl,
        }),
      )
      .eq("id", petId);

    if (error) {
      return {
        ok: false,
        message: error.message || "Error updating pet post.",
        error,
      };
    }

    return {
      ok: true,
      redirectTo: "/pets",
      message: "Pet post updated.",
    };
  }

  async deletePet(petId) {
    const { error } = await this.supabase
      .from("pets")
      .delete()
      .eq("id", petId);

    if (error) {
      return {
        ok: false,
        message: error.message || "Error deleting pet post",
        error,
      };
    }

    return {
      ok: true,
      redirectTo: "/pets",
      message: "Pet post deleted",
    };
  }
}

Object.freeze(PetApplication);
