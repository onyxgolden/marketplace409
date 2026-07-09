import { describe, expect, it, vi } from "vitest";

import { InvestorPropertyApplication } from "./InvestorPropertyApplication";

function createSupabaseMock({
  user = { id: "user-1" },
  loadData = null,
  loadError = null,
  insertError = null,
  updateError = null,
  deleteError = null,
} = {}) {
  const insert = vi.fn(async () => ({ error: insertError }));
  const updateEq = vi.fn(async () => ({ error: updateError }));
  const update = vi.fn(() => ({ eq: updateEq }));
  const deleteEq = vi.fn(async () => ({ error: deleteError }));
  const deleteFn = vi.fn(() => ({ eq: deleteEq }));
  const single = vi.fn(async () => ({ data: loadData, error: loadError }));
  const selectEq = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ eq: selectEq }));

  const from = vi.fn((table) => {
    expect(table).toBe("investor_properties");

    return {
      insert,
      select,
      update,
      delete: deleteFn,
    };
  });

  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user },
      })),
    },
    from,
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn(async () => ({ error: null })),
        getPublicUrl: vi.fn(() => ({ data: { publicUrl: "image-url" } })),
      })),
    },
    mocks: {
      insert,
      update,
      updateEq,
      deleteFn,
      deleteEq,
      select,
      selectEq,
      single,
    },
  };
}

describe("InvestorPropertyApplication", () => {
  it("creates an initial property form", () => {
    const application = new InvestorPropertyApplication();

    expect(application.getInitialPropertyForm()).toEqual({
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
  });

  it("requires authentication before creating a property", async () => {
    const supabase = createSupabaseMock({ user: null });
    const application = new InvestorPropertyApplication({ supabase });

    const result = await application.createProperty({
      form: application.getInitialPropertyForm(),
      image: null,
    });

    expect(result).toEqual({
      ok: false,
      reason: "authentication_required",
      message:
        "Please create a free account before posting an investment property.",
    });
    expect(supabase.mocks.insert).not.toHaveBeenCalled();
  });

  it("creates an investor property", async () => {
    const supabase = createSupabaseMock();
    const application = new InvestorPropertyApplication({ supabase });

    const result = await application.createProperty({
      form: {
        address: "170 John",
        city: "Orange",
        county: "Orange",
        asking_price: "100000",
        arv: "",
        rehab_cost: "20000",
        estimated_rent: "1200",
        bedrooms: "3",
        bathrooms: "2",
        sqft: "1500",
        lot_size: "0.25",
        occupancy: "Vacant",
        property_type: "Single Family",
        summary: "Needs work",
        image_url: "",
      },
      image: null,
    });

    expect(supabase.mocks.insert).toHaveBeenCalledWith([
      {
        address: "170 John",
        city: "Orange",
        county: "Orange",
        asking_price: "100000",
        arv: null,
        rehab_cost: "20000",
        estimated_rent: "1200",
        bedrooms: "3",
        bathrooms: "2",
        sqft: "1500",
        lot_size: "0.25",
        occupancy: "Vacant",
        property_type: "Single Family",
        summary: "Needs work",
        image_url: "",
        created_by: "user-1",
      },
    ]);

    expect(result).toEqual({
      ok: true,
      redirectTo: "/investors/properties",
      message: "Investment property posted!",
    });
  });

  it("loads an investor property into a form", async () => {
    const supabase = createSupabaseMock({
      loadData: {
        address: "170 John",
        city: "Orange",
        county: "Orange",
        asking_price: 100000,
      },
    });

    const application = new InvestorPropertyApplication({ supabase });

    const result = await application.loadProperty("property-1");

    expect(supabase.mocks.selectEq).toHaveBeenCalledWith("id", "property-1");
    expect(result.ok).toBe(true);
    expect(result.form).toMatchObject({
      address: "170 John",
      city: "Orange",
      county: "Orange",
      asking_price: 100000,
      arv: "",
    });
  });

  it("updates an investor property", async () => {
    const supabase = createSupabaseMock();
    const imageUploader = vi.fn(async () => "updated-image-url");

    const application = new InvestorPropertyApplication({
      supabase,
      imageUploader,
    });

    const form = {
      ...application.getInitialPropertyForm(),
      address: "170 John",
      asking_price: "",
      image_url: "current-image-url",
    };

    const result = await application.updateProperty({
      propertyId: "property-1",
      form,
      newImage: null,
    });

    expect(imageUploader).toHaveBeenCalledWith({
      file: null,
      currentImageUrl: "current-image-url",
      folder: "investor-properties",
      prefix: "investor-property",
      recordId: "property-1",
    });

    expect(supabase.mocks.update).toHaveBeenCalledWith({
      ...form,
      image_url: "updated-image-url",
      asking_price: null,
      arv: null,
      rehab_cost: null,
      estimated_rent: null,
      bedrooms: null,
      bathrooms: null,
      sqft: null,
    });

    expect(supabase.mocks.updateEq).toHaveBeenCalledWith("id", "property-1");
    expect(result).toEqual({
      ok: true,
      redirectTo: "/investors/properties",
    });
  });

  it("deletes an investor property", async () => {
    const supabase = createSupabaseMock();
    const application = new InvestorPropertyApplication({ supabase });

    const result = await application.deleteProperty("property-1");

    expect(supabase.mocks.deleteEq).toHaveBeenCalledWith("id", "property-1");
    expect(result).toEqual({
      ok: true,
      redirectTo: "/investors/properties",
    });
  });
});
