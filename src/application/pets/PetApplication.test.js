import { describe, expect, it, vi } from "vitest";

import { PetApplication } from "./PetApplication";

function createSupabaseMock({
  user = { id: "user-1" },
  loadData = null,
  loadError = null,
  insertError = null,
  updateError = null,
  deleteError = null,
} = {}) {
  const getUser = vi.fn(async () => ({
    data: {
      user,
    },
  }));

  const insert = vi.fn(async () => ({
    error: insertError,
  }));

  const updateEq = vi.fn(async () => ({
    error: updateError,
  }));

  const update = vi.fn(() => ({
    eq: updateEq,
  }));

  const deleteEq = vi.fn(async () => ({
    error: deleteError,
  }));

  const deleteFn = vi.fn(() => ({
    eq: deleteEq,
  }));

  const single = vi.fn(async () => ({
    data: loadData,
    error: loadError,
  }));

  const selectEq = vi.fn(() => ({
    single,
  }));

  const select = vi.fn(() => ({
    eq: selectEq,
  }));

  const from = vi.fn((table) => {
    expect(table).toBe("pets");

    return {
      insert,
      select,
      update,
      delete: deleteFn,
    };
  });

  return {
    auth: {
      getUser,
    },
    from,
    mocks: {
      getUser,
      from,
      insert,
      select,
      selectEq,
      single,
      update,
      updateEq,
      deleteFn,
      deleteEq,
    },
  };
}

function createPetForm(application) {
  return {
    ...application.getInitialPetForm(),
    petName: "Forge",
    petType: "Dog",
    postType: "Personal Pet",
    petOfWeekEligible: true,
    description: "Friendly local dog.",
    contactName: "Jason Morgan",
    contactPhone: "409-555-0000",
    contactEmail: "pets@example.com",
    city: "Orange",
    imageUrl: "current-image-url",
  };
}

describe("PetApplication", () => {
  it("creates an initial pet form", () => {
    const application = new PetApplication();

    expect(application.getInitialPetForm()).toEqual({
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
  });

  it("creates independent initial pet forms", () => {
    const application = new PetApplication();

    const firstForm = application.getInitialPetForm();
    const secondForm = application.getInitialPetForm();

    firstForm.petName = "Changed";
    firstForm.petOfWeekEligible = true;

    expect(secondForm).toEqual({
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
  });

  it("requires authentication before creating a pet post", async () => {
    const supabase = createSupabaseMock({
      user: null,
    });

    const imageUploader = vi.fn();

    const application = new PetApplication({
      supabase,
      imageUploader,
    });

    const result = await application.createPet({
      form: application.getInitialPetForm(),
      imageFile: null,
    });

    expect(imageUploader).not.toHaveBeenCalled();
    expect(supabase.mocks.insert).not.toHaveBeenCalled();

    expect(result).toEqual({
      ok: false,
      redirectTo: "/auth",
      message: "Please create a free account before posting a pet.",
      requiresAuthentication: true,
    });
  });

  it("creates a pet post after coordinating image upload", async () => {
    const supabase = createSupabaseMock();
    const imageUploader = vi.fn(async () => "new-image-url");

    const application = new PetApplication({
      supabase,
      imageUploader,
    });

    const form = createPetForm(application);
    const imageFile = {
      name: "forge.jpg",
      type: "image/jpeg",
    };

    const result = await application.createPet({
      form,
      imageFile,
    });

    expect(supabase.mocks.getUser).toHaveBeenCalledOnce();

    expect(imageUploader).toHaveBeenCalledWith({
      file: imageFile,
      currentImageUrl: "",
      folder: "pets",
      prefix: "pet",
      recordId: "new",
    });

    expect(supabase.mocks.insert).toHaveBeenCalledWith([
      {
        pet_name: "Forge",
        pet_type: "Dog",
        post_type: "Personal Pet",
        description: "Friendly local dog.",
        image_url: "new-image-url",
        contact_name: "Jason Morgan",
        contact_phone: "409-555-0000",
        contact_email: "pets@example.com",
        city: "Orange",
        votes: 0,
        pet_of_week_eligible: true,
      },
    ]);

    expect(result).toEqual({
      ok: true,
      redirectTo: "/pets",
      message: "Pet post added!",
    });
  });

  it("stops pet creation when image upload throws", async () => {
    const supabase = createSupabaseMock();
    const uploadError = new Error("Error uploading pet image");

    const imageUploader = vi.fn(async () => {
      throw uploadError;
    });

    const application = new PetApplication({
      supabase,
      imageUploader,
    });

    const result = await application.createPet({
      form: application.getInitialPetForm(),
      imageFile: {
        name: "forge.jpg",
        type: "image/jpeg",
      },
    });

    expect(supabase.mocks.insert).not.toHaveBeenCalled();

    expect(result).toEqual({
      ok: false,
      message: "Error uploading pet image",
      error: uploadError,
    });
  });

  it("stops pet creation when the uploader returns no image URL", async () => {
    const supabase = createSupabaseMock();
    const imageUploader = vi.fn(async () => "");

    const application = new PetApplication({
      supabase,
      imageUploader,
    });

    const result = await application.createPet({
      form: application.getInitialPetForm(),
      imageFile: {
        name: "forge.jpg",
        type: "image/jpeg",
      },
    });

    expect(supabase.mocks.insert).not.toHaveBeenCalled();

    expect(result).toMatchObject({
      ok: false,
      message: "Error uploading pet image",
    });

    expect(result.error).toBeInstanceOf(Error);
  });

  it("normalizes pet creation failures", async () => {
    const insertError = {
      message: "Insert failed",
    };

    const supabase = createSupabaseMock({
      insertError,
    });

    const imageUploader = vi.fn(async () => "");

    const application = new PetApplication({
      supabase,
      imageUploader,
    });

    const result = await application.createPet({
      form: application.getInitialPetForm(),
      imageFile: null,
    });

    expect(result).toEqual({
      ok: false,
      message: "Insert failed",
      error: insertError,
    });
  });

  it("provides a fallback pet creation error message", async () => {
    const insertError = {};

    const supabase = createSupabaseMock({
      insertError,
    });

    const imageUploader = vi.fn(async () => "");

    const application = new PetApplication({
      supabase,
      imageUploader,
    });

    const result = await application.createPet({
      form: application.getInitialPetForm(),
      imageFile: null,
    });

    expect(result).toEqual({
      ok: false,
      message: "Error adding pet post",
      error: insertError,
    });
  });

  it("loads a pet post into a form", async () => {
    const supabase = createSupabaseMock({
      loadData: {
        pet_name: "Forge",
        pet_type: "Dog",
        post_type: "Personal Pet",
        pet_of_week_eligible: true,
        description: "Friendly local dog.",
        contact_name: "Jason Morgan",
        contact_phone: "409-555-0000",
        contact_email: "pets@example.com",
        city: "Orange",
        image_url: "current-image-url",
      },
    });

    const application = new PetApplication({
      supabase,
    });

    const result = await application.loadPet("pet-1");

    expect(supabase.mocks.selectEq).toHaveBeenCalledWith("id", "pet-1");

    expect(result).toEqual({
      ok: true,
      form: {
        petName: "Forge",
        petType: "Dog",
        postType: "Personal Pet",
        petOfWeekEligible: true,
        description: "Friendly local dog.",
        contactName: "Jason Morgan",
        contactPhone: "409-555-0000",
        contactEmail: "pets@example.com",
        city: "Orange",
        imageUrl: "current-image-url",
      },
    });
  });

  it("normalizes missing pet posts", async () => {
    const loadError = {
      message: "Not found",
    };

    const supabase = createSupabaseMock({
      loadData: null,
      loadError,
    });

    const application = new PetApplication({
      supabase,
    });

    const result = await application.loadPet("missing-pet");

    expect(result).toEqual({
      ok: false,
      redirectTo: "/pets",
      message: "Pet post not found.",
      error: loadError,
    });
  });

  it("updates a pet post after coordinating image upload", async () => {
    const supabase = createSupabaseMock();
    const imageUploader = vi.fn(async () => "updated-image-url");

    const application = new PetApplication({
      supabase,
      imageUploader,
    });

    const form = createPetForm(application);
    const imageFile = {
      name: "updated-forge.jpg",
      type: "image/jpeg",
    };

    const result = await application.updatePet({
      petId: "pet-1",
      form,
      imageFile,
    });

    expect(imageUploader).toHaveBeenCalledWith({
      file: imageFile,
      currentImageUrl: "current-image-url",
      folder: "pets",
      prefix: "pet",
      recordId: "pet-1",
    });

    expect(supabase.mocks.update).toHaveBeenCalledWith({
      pet_name: "Forge",
      pet_type: "Dog",
      post_type: "Personal Pet",
      pet_of_week_eligible: true,
      description: "Friendly local dog.",
      contact_name: "Jason Morgan",
      contact_phone: "409-555-0000",
      contact_email: "pets@example.com",
      city: "Orange",
      image_url: "updated-image-url",
    });

    expect(supabase.mocks.updateEq).toHaveBeenCalledWith("id", "pet-1");

    expect(result).toEqual({
      ok: true,
      redirectTo: "/pets",
      message: "Pet post updated.",
    });
  });

  it("stops pet updates when a replacement upload returns the current URL", async () => {
    const supabase = createSupabaseMock();
    const imageUploader = vi.fn(async () => "current-image-url");

    const application = new PetApplication({
      supabase,
      imageUploader,
    });

    const result = await application.updatePet({
      petId: "pet-1",
      form: {
        ...application.getInitialPetForm(),
        imageUrl: "current-image-url",
      },
      imageFile: {
        name: "replacement.jpg",
        type: "image/jpeg",
      },
    });

    expect(supabase.mocks.update).not.toHaveBeenCalled();

    expect(result).toMatchObject({
      ok: false,
      message: "Error uploading pet image",
    });

    expect(result.error).toBeInstanceOf(Error);
  });

  it("normalizes pet update failures", async () => {
    const updateError = {
      message: "Update failed",
    };

    const supabase = createSupabaseMock({
      updateError,
    });

    const imageUploader = vi.fn(async () => "current-image-url");

    const application = new PetApplication({
      supabase,
      imageUploader,
    });

    const result = await application.updatePet({
      petId: "pet-1",
      form: application.getInitialPetForm(),
      imageFile: null,
    });

    expect(result).toEqual({
      ok: false,
      message: "Update failed",
      error: updateError,
    });
  });

  it("deletes a pet post", async () => {
    const supabase = createSupabaseMock();

    const application = new PetApplication({
      supabase,
    });

    const result = await application.deletePet("pet-1");

    expect(supabase.mocks.deleteEq).toHaveBeenCalledWith("id", "pet-1");

    expect(result).toEqual({
      ok: true,
      redirectTo: "/pets",
      message: "Pet post deleted",
    });
  });

  it("normalizes pet deletion failures", async () => {
    const deleteError = {
      message: "Delete failed",
    };

    const supabase = createSupabaseMock({
      deleteError,
    });

    const application = new PetApplication({
      supabase,
    });

    const result = await application.deletePet("pet-1");

    expect(result).toEqual({
      ok: false,
      message: "Delete failed",
      error: deleteError,
    });
  });
});
