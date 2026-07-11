import { describe, expect, it, vi } from "vitest";

import { ListingApplication } from "./ListingApplication";

function createSupabaseMock({
  user = { id: "user-1" },
  insertData = { id: "listing-1" },
  insertError = null,
} = {}) {
  const getUser = vi.fn(async () => ({
    data: {
      user,
    },
  }));

  const single = vi.fn(async () => ({
    data: insertData,
    error: insertError,
  }));

  const select = vi.fn(() => ({
    single,
  }));

  const insert = vi.fn(() => ({
    select,
  }));

  const from = vi.fn((table) => {
    expect(table).toBe("listings");

    return {
      insert,
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
      single,
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
    });
  });

  it("creates independent initial listing forms", () => {
    const application = new ListingApplication();

    const firstForm = application.getInitialListingForm();
    const secondForm = application.getInitialListingForm();

    firstForm.title = "Changed";

    expect(secondForm).toEqual({
      title: "",
      description: "",
      price: "",
      category: "",
      city: "",
      sellerName: "",
      sellerEmail: "",
      sellerPhone: "",
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
});
