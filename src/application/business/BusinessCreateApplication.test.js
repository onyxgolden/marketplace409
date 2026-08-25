import { describe, expect, it, vi } from "vitest";

import { BusinessCreateApplication } from "./BusinessCreateApplication";

const COMPLETE_FORM = {
  name: " Arctic Air ",
  category: " HVAC Contractors ",
  city: " Southeast Texas ",
  phone: " 409-299-5584 ",
  websiteUrl: " https://ArcticTexas.com ",
  facebookUrl: "",
  description: " Thorough HVAC diagnostics, repair, maintenance, and installation. ",
  trustTags: ["Community Listing", "Licensed Contractor"],
};

function createSupabaseMock({ insertError = null } = {}) {
  const insert = vi.fn(async () => ({ error: insertError }));
  const from = vi.fn(() => ({ insert }));
  return { from, mocks: { from, insert } };
}

describe("BusinessCreateApplication", () => {
  it("creates a complete, independent business form", () => {
    const application = new BusinessCreateApplication();
    const firstForm = application.getInitialBusinessCreateForm();
    const secondForm = application.getInitialBusinessCreateForm();

    expect(firstForm).toEqual({
      name: "",
      category: "",
      city: "",
      phone: "",
      websiteUrl: "",
      facebookUrl: "",
      description: "",
      trustTags: [],
    });

    firstForm.trustTags.push("Community Listing");
    expect(secondForm.trustTags).toEqual([]);
  });

  it("uploads the image and creates a complete directory listing", async () => {
    const supabase = createSupabaseMock();
    const imageFile = { name: "arctic-air.jpg" };
    const imageUploader = vi.fn(async () => "https://images/arctic-air.jpg");
    const application = new BusinessCreateApplication({ supabase, imageUploader });

    const result = await application.createBusiness({ form: COMPLETE_FORM, imageFile });

    expect(imageUploader).toHaveBeenCalledWith({
      file: imageFile,
      currentImageUrl: "",
      folder: "businesses",
      prefix: "business",
      recordId: "new",
    });
    expect(supabase.mocks.from).toHaveBeenCalledWith("businesses");
    expect(supabase.mocks.insert).toHaveBeenCalledWith([{
      name: "Arctic Air",
      category: "HVAC Contractors",
      city: "Southeast Texas",
      phone: "409-299-5584",
      website_url: "https://ArcticTexas.com",
      facebook_url: "",
      description: "Thorough HVAC diagnostics, repair, maintenance, and installation.",
      trust_tags: ["Community Listing", "Licensed Contractor"],
      image_url: "https://images/arctic-air.jpg",
    }]);
    expect(result).toEqual({
      ok: true,
      redirectTo: "/businesses",
      message: "Business created!",
    });
  });

  it("normalizes business creation failures", async () => {
    const insertError = { message: "Insert failed" };
    const supabase = createSupabaseMock({ insertError });
    const application = new BusinessCreateApplication({
      supabase,
      imageUploader: vi.fn(async () => ""),
    });

    const result = await application.createBusiness({
      form: COMPLETE_FORM,
      imageFile: null,
    });

    expect(result).toEqual({
      ok: false,
      message: "Insert failed",
      error: insertError,
    });
  });

  it("provides a fallback creation error message", async () => {
    const insertError = {};
    const supabase = createSupabaseMock({ insertError });
    const application = new BusinessCreateApplication({
      supabase,
      imageUploader: vi.fn(async () => ""),
    });

    const result = await application.createBusiness({
      form: COMPLETE_FORM,
      imageFile: null,
    });

    expect(result).toEqual({
      ok: false,
      message: "Failed to create business",
      error: insertError,
    });
  });
});
