import { describe, expect, it, vi } from "vitest";

import { ListingApplication } from "./ListingApplication";

function createSupabaseMock({
  user = { id: "user-1" },
  insertData = { id: "listing-1" },
  insertError = null,
  loadData = null,
  loadError = null,
  updateError = null,
} = {}) {
  const getUser = vi.fn(async () => ({
    data: {
      user,
    },
  }));

  const insertSingle = vi.fn(async () => ({
    data: insertData,
    error: insertError,
  }));

  const insertSelect = vi.fn(() => ({
    single: insertSingle,
  }));

  const insert = vi.fn(() => ({
    select: insertSelect,
  }));

  const loadSingle = vi.fn(async () => ({
    data: loadData,
    error: loadError,
  }));

  const selectEq = vi.fn(() => ({
    single: loadSingle,
  }));

  const select = vi.fn(() => ({
    eq: selectEq,
  }));

  const updateEq = vi.fn(async () => ({
    error: updateError,
  }));

  const update = vi.fn(() => ({
    eq: updateEq,
  }));

  const from = vi.fn((table) => {
    expect(table).toBe("listings");

    return {
      insert,
      select,
      update,
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
      insertSelect,
      insertSingle,
      select,
      selectEq,
      loadSingle,
      update,
      updateEq,
    },
  };
}

function createListingForm(application) {
  return {
    ...application.getInitialListingForm(),
    title: "Utility Trailer",
    description: "Heavy-duty local utility trailer.",
    price: "2500",
    category: "Tools & Equipment",
    city: "Orange",
    sellerName: "Jason Morgan",
    sellerEmail: "seller@example.com",
    sellerPhone: "409-555-0000",
    imageUrl: "current-image-url",
  };
}

describe("ListingApplication", () => {
  it("creates an initial listing form", () => {
    const application = new ListingApplication();

    expect(application.getInitialListingForm()).toEqual({
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
  });

  it("creates independent initial listing forms", () => {
    const application = new ListingApplication();

    const firstForm = application.getInitialListingForm();
    const secondForm = application.getInitialListingForm();

    firstForm.title = "Changed";
    firstForm.imageUrl = "changed-image";

    expect(secondForm).toEqual({
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
  });

  it("requires authentication before creating a listing", async () => {
    const supabase = createSupabaseMock({
      user: null,
    });

    const imageUploader = vi.fn();

    const application = new ListingApplication({
      supabase,
      imageUploader,
    });

    const result = await application.createListing({
      form: application.getInitialListingForm(),
      imageFiles: [],
    });

    expect(imageUploader).not.toHaveBeenCalled();
    expect(supabase.mocks.insert).not.toHaveBeenCalled();

    expect(result).toEqual({
      ok: false,
      redirectTo: "/auth",
      message:
        "You can browse listings as a guest, but you need a free account to post.",
      requiresAuthentication: true,
    });
  });

  it("creates a listing without images", async () => {
    const supabase = createSupabaseMock();
    const imageUploader = vi.fn();

    const application = new ListingApplication({
      supabase,
      imageUploader,
    });

    const form = createListingForm(application);

    const result = await application.createListing({
      form,
      imageFiles: [],
    });

    expect(imageUploader).not.toHaveBeenCalled();

    expect(supabase.mocks.insert).toHaveBeenCalledWith([
      {
        title: "Utility Trailer",
        description: "Heavy-duty local utility trailer.",
        price: "2500",
        category: "Tools & Equipment",
        city: "Orange",
        image_url: "",
        image_urls: [],
        seller_name: "Jason Morgan",
        seller_email: "seller@example.com",
        seller_phone: "409-555-0000",
        user_id: "user-1",
      },
    ]);

    expect(result).toEqual({
      ok: true,
      redirectTo: "/listing/listing-1",
      message: "Listing posted successfully!",
      listingId: "listing-1",
    });
  });

  it("coordinates multiple image uploads before creating a listing", async () => {
    const supabase = createSupabaseMock();

    const imageUploader = vi
      .fn()
      .mockResolvedValueOnce("image-1-url")
      .mockResolvedValueOnce("image-2-url");

    const application = new ListingApplication({
      supabase,
      imageUploader,
    });

    const form = createListingForm(application);
    const imageFiles = [
      {
        name: "front.jpg",
        type: "image/jpeg",
      },
      {
        name: "side.jpg",
        type: "image/jpeg",
      },
    ];

    const result = await application.createListing({
      form,
      imageFiles,
    });

    expect(imageUploader).toHaveBeenNthCalledWith(1, {
      file: imageFiles[0],
      currentImageUrl: "",
      folder: "listings",
      prefix: "listing",
      recordId: "new",
    });

    expect(imageUploader).toHaveBeenNthCalledWith(2, {
      file: imageFiles[1],
      currentImageUrl: "",
      folder: "listings",
      prefix: "listing",
      recordId: "new",
    });

    expect(supabase.mocks.insert).toHaveBeenCalledWith([
      {
        title: "Utility Trailer",
        description: "Heavy-duty local utility trailer.",
        price: "2500",
        category: "Tools & Equipment",
        city: "Orange",
        image_url: "image-1-url",
        image_urls: ["image-1-url", "image-2-url"],
        seller_name: "Jason Morgan",
        seller_email: "seller@example.com",
        seller_phone: "409-555-0000",
        user_id: "user-1",
      },
    ]);

    expect(result.ok).toBe(true);
  });

  it("stops listing creation when an image upload throws", async () => {
    const supabase = createSupabaseMock();
    const uploadError = new Error("Upload failed");

    const imageUploader = vi.fn(async () => {
      throw uploadError;
    });

    const application = new ListingApplication({
      supabase,
      imageUploader,
    });

    const result = await application.createListing({
      form: application.getInitialListingForm(),
      imageFiles: [
        {
          name: "listing.jpg",
          type: "image/jpeg",
        },
      ],
    });

    expect(supabase.mocks.insert).not.toHaveBeenCalled();

    expect(result).toEqual({
      ok: false,
      message: "Upload failed",
      error: uploadError,
    });
  });

  it("stops listing creation when an image upload returns no URL", async () => {
    const supabase = createSupabaseMock();
    const imageUploader = vi.fn(async () => "");

    const application = new ListingApplication({
      supabase,
      imageUploader,
    });

    const result = await application.createListing({
      form: application.getInitialListingForm(),
      imageFiles: [
        {
          name: "listing.jpg",
          type: "image/jpeg",
        },
      ],
    });

    expect(supabase.mocks.insert).not.toHaveBeenCalled();

    expect(result).toMatchObject({
      ok: false,
      message: "Error uploading listing image",
    });

    expect(result.error).toBeInstanceOf(Error);
  });

  it("normalizes listing creation failures", async () => {
    const insertError = {
      message: "Insert failed",
    };

    const supabase = createSupabaseMock({
      insertData: null,
      insertError,
    });

    const application = new ListingApplication({
      supabase,
      imageUploader: vi.fn(),
    });

    const result = await application.createListing({
      form: application.getInitialListingForm(),
      imageFiles: [],
    });

    expect(result).toEqual({
      ok: false,
      message: "Insert failed",
      error: insertError,
    });
  });

  it("provides a fallback listing creation error message", async () => {
    const insertError = {};

    const supabase = createSupabaseMock({
      insertData: null,
      insertError,
    });

    const application = new ListingApplication({
      supabase,
      imageUploader: vi.fn(),
    });

    const result = await application.createListing({
      form: application.getInitialListingForm(),
      imageFiles: [],
    });

    expect(result).toEqual({
      ok: false,
      message: "Error posting listing",
      error: insertError,
    });
  });

  it("loads a listing into an edit form", async () => {
    const supabase = createSupabaseMock({
      loadData: {
        title: "Utility Trailer",
        description: "Heavy-duty local utility trailer.",
        price: "2500",
        category: "Tools & Equipment",
        city: "Orange",
        seller_name: "Jason Morgan",
        seller_email: "seller@example.com",
        seller_phone: "409-555-0000",
        image_url: "current-image-url",
      },
    });

    const application = new ListingApplication({
      supabase,
    });

    const result = await application.loadListing("listing-1");

    expect(supabase.mocks.selectEq).toHaveBeenCalledWith(
      "id",
      "listing-1",
    );

    expect(result).toEqual({
      ok: true,
      form: {
        title: "Utility Trailer",
        description: "Heavy-duty local utility trailer.",
        price: "2500",
        category: "Tools & Equipment",
        city: "Orange",
        sellerName: "Jason Morgan",
        sellerEmail: "seller@example.com",
        sellerPhone: "409-555-0000",
        imageUrl: "current-image-url",
      },
    });
  });

  it("normalizes missing listings", async () => {
    const loadError = {
      message: "Not found",
    };

    const supabase = createSupabaseMock({
      loadData: null,
      loadError,
    });

    const application = new ListingApplication({
      supabase,
    });

    const result = await application.loadListing("missing-listing");

    expect(result).toEqual({
      ok: false,
      redirectTo: "/my-listings",
      message: "Listing not found.",
      error: loadError,
    });
  });

  it("updates a listing while keeping its current image", async () => {
    const supabase = createSupabaseMock();
    const imageUploader = vi.fn(async ({ currentImageUrl }) =>
      currentImageUrl
    );

    const application = new ListingApplication({
      supabase,
      imageUploader,
    });

    const form = createListingForm(application);

    const result = await application.updateListing({
      listingId: "listing-1",
      form,
      newImageFile: null,
    });

    expect(imageUploader).toHaveBeenCalledWith({
      file: null,
      currentImageUrl: "current-image-url",
      folder: "listings",
      prefix: "listing",
      recordId: "listing-1",
    });

    expect(supabase.mocks.update).toHaveBeenCalledWith({
      title: "Utility Trailer",
      description: "Heavy-duty local utility trailer.",
      price: "2500",
      category: "Tools & Equipment",
      city: "Orange",
      seller_name: "Jason Morgan",
      seller_email: "seller@example.com",
      seller_phone: "409-555-0000",
      image_url: "current-image-url",
    });

    expect(supabase.mocks.updateEq).toHaveBeenCalledWith(
      "id",
      "listing-1",
    );

    expect(result).toEqual({
      ok: true,
      redirectTo: "/listing/listing-1",
      message: "Listing updated.",
    });
  });

  it("coordinates replacement image upload before updating a listing", async () => {
    const supabase = createSupabaseMock();
    const imageUploader = vi.fn(async () => "replacement-image-url");

    const application = new ListingApplication({
      supabase,
      imageUploader,
    });

    const form = createListingForm(application);
    const newImageFile = {
      name: "replacement.jpg",
      type: "image/jpeg",
    };

    const result = await application.updateListing({
      listingId: "listing-1",
      form,
      newImageFile,
    });

    expect(imageUploader).toHaveBeenCalledWith({
      file: newImageFile,
      currentImageUrl: "current-image-url",
      folder: "listings",
      prefix: "listing",
      recordId: "listing-1",
    });

    expect(supabase.mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        image_url: "replacement-image-url",
      }),
    );

    expect(result.ok).toBe(true);
  });

  it("stops listing updates when image upload throws", async () => {
    const supabase = createSupabaseMock();
    const uploadError = new Error("Replacement upload failed");

    const imageUploader = vi.fn(async () => {
      throw uploadError;
    });

    const application = new ListingApplication({
      supabase,
      imageUploader,
    });

    const result = await application.updateListing({
      listingId: "listing-1",
      form: createListingForm(application),
      newImageFile: {
        name: "replacement.jpg",
        type: "image/jpeg",
      },
    });

    expect(supabase.mocks.update).not.toHaveBeenCalled();

    expect(result).toEqual({
      ok: false,
      message: "Replacement upload failed",
      error: uploadError,
    });
  });

  it("stops listing updates when replacement upload returns the current URL", async () => {
    const supabase = createSupabaseMock();
    const imageUploader = vi.fn(async () => "current-image-url");

    const application = new ListingApplication({
      supabase,
      imageUploader,
    });

    const result = await application.updateListing({
      listingId: "listing-1",
      form: createListingForm(application),
      newImageFile: {
        name: "replacement.jpg",
        type: "image/jpeg",
      },
    });

    expect(supabase.mocks.update).not.toHaveBeenCalled();

    expect(result).toMatchObject({
      ok: false,
      message: "Error uploading listing image",
    });

    expect(result.error).toBeInstanceOf(Error);
  });

  it("normalizes listing update failures", async () => {
    const updateError = {
      message: "Update failed",
    };

    const supabase = createSupabaseMock({
      updateError,
    });

    const imageUploader = vi.fn(async ({ currentImageUrl }) =>
      currentImageUrl
    );

    const application = new ListingApplication({
      supabase,
      imageUploader,
    });

    const result = await application.updateListing({
      listingId: "listing-1",
      form: createListingForm(application),
      newImageFile: null,
    });

    expect(result).toEqual({
      ok: false,
      message: "Update failed",
      error: updateError,
    });
  });

  it("provides a fallback listing update error message", async () => {
    const updateError = {};

    const supabase = createSupabaseMock({
      updateError,
    });

    const imageUploader = vi.fn(async ({ currentImageUrl }) =>
      currentImageUrl
    );

    const application = new ListingApplication({
      supabase,
      imageUploader,
    });

    const result = await application.updateListing({
      listingId: "listing-1",
      form: createListingForm(application),
      newImageFile: null,
    });

    expect(result).toEqual({
      ok: false,
      message: "Error saving listing.",
      error: updateError,
    });
  });
});
