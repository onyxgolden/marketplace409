import { describe, expect, it, vi } from "vitest";

import { BusinessEditApplication } from "./BusinessEditApplication";

function createSupabaseMock({
  loadData = null,
  loadError = null,
  updateError = null,
} = {}) {
  const updateEq = vi.fn(async () => ({ error: updateError }));
  const update = vi.fn(() => ({ eq: updateEq }));
  const single = vi.fn(async () => ({
    data: loadData,
    error: loadError,
  }));
  const selectEq = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ eq: selectEq }));

  const from = vi.fn((table) => {
    expect(table).toBe("businesses");

    return {
      select,
      update,
    };
  });

  return {
    from,
    mocks: {
      select,
      selectEq,
      single,
      update,
      updateEq,
    },
  };
}

describe("BusinessEditApplication", () => {
  it("creates an initial business edit form", () => {
    const application = new BusinessEditApplication();

    expect(application.getInitialBusinessEditForm()).toEqual({
      name: "",
      category: "",
      city: "",
      phone: "",
      websiteUrl: "",
      facebookUrl: "",
      description: "",
      trustTags: [],
      imageUrl: "",
    });
  });

  it("creates independent initial trust tag arrays", () => {
    const application = new BusinessEditApplication();

    const firstForm = application.getInitialBusinessEditForm();
    const secondForm = application.getInitialBusinessEditForm();

    firstForm.trustTags.push("Texas Made");

    expect(secondForm.trustTags).toEqual([]);
  });

  it("loads a business into an edit form", async () => {
    const supabase = createSupabaseMock({
      loadData: {
        name: "409 Roofing",
        category: "Contractor",
        city: "Orange",
        phone: "409-555-0000",
        website_url: "https://example.com",
        facebook_url: "https://facebook.com/example",
        description: "Local roofing company",
        trust_tags: ["Texas Made", "Family Owned"],
        image_url: "current-image-url",
      },
    });

    const application = new BusinessEditApplication({ supabase });

    const result = await application.loadBusiness("business-1");

    expect(supabase.mocks.selectEq).toHaveBeenCalledWith(
      "id",
      "business-1",
    );

    expect(result).toEqual({
      ok: true,
      form: {
        name: "409 Roofing",
        category: "Contractor",
        city: "Orange",
        phone: "409-555-0000",
        websiteUrl: "https://example.com",
        facebookUrl: "https://facebook.com/example",
        description: "Local roofing company",
        trustTags: ["Texas Made", "Family Owned"],
        imageUrl: "current-image-url",
      },
    });
  });

  it("normalizes missing businesses", async () => {
    const supabase = createSupabaseMock({
      loadData: null,
      loadError: { message: "Not found" },
    });

    const application = new BusinessEditApplication({ supabase });

    const result = await application.loadBusiness("missing-business");

    expect(result).toEqual({
      ok: false,
      redirectTo: "/businesses",
      message: "Business not found.",
      error: { message: "Not found" },
    });
  });

  it("updates a business after coordinating image upload", async () => {
    const supabase = createSupabaseMock();
    const imageUploader = vi.fn(async () => "updated-image-url");

    const application = new BusinessEditApplication({
      supabase,
      imageUploader,
    });

    const newImageFile = {
      name: "business.jpg",
      type: "image/jpeg",
    };

    const result = await application.updateBusiness({
      businessId: "business-1",
      form: {
        name: "409 Roofing",
        category: "Contractor",
        city: "Orange",
        phone: "409-555-0000",
        websiteUrl: "https://example.com",
        facebookUrl: "https://facebook.com/example",
        description: "Updated description",
        trustTags: ["Texas Made", "Licensed Contractor"],
        imageUrl: "current-image-url",
      },
      newImageFile,
    });

    expect(imageUploader).toHaveBeenCalledWith({
      file: newImageFile,
      currentImageUrl: "current-image-url",
      folder: "businesses",
      prefix: "business",
      recordId: "business-1",
    });

    expect(supabase.mocks.update).toHaveBeenCalledWith({
      name: "409 Roofing",
      category: "Contractor",
      city: "Orange",
      phone: "409-555-0000",
      website_url: "https://example.com",
      facebook_url: "https://facebook.com/example",
      description: "Updated description",
      trust_tags: ["Texas Made", "Licensed Contractor"],
      image_url: "updated-image-url",
    });

    expect(supabase.mocks.updateEq).toHaveBeenCalledWith(
      "id",
      "business-1",
    );

    expect(result).toEqual({
      ok: true,
      redirectTo: "/businesses",
      message: "Business updated!",
    });
  });

  it("normalizes business update failures", async () => {
    const updateError = { message: "Update failed" };
    const supabase = createSupabaseMock({ updateError });
    const imageUploader = vi.fn(async () => "current-image-url");

    const application = new BusinessEditApplication({
      supabase,
      imageUploader,
    });

    const result = await application.updateBusiness({
      businessId: "business-1",
      form: application.getInitialBusinessEditForm(),
      newImageFile: null,
    });

    expect(result).toEqual({
      ok: false,
      message: "Error updating business",
      error: updateError,
    });
  });
});
