import { describe, expect, it, vi } from "vitest";

import { InvestorWholesalerApplication } from "./InvestorWholesalerApplication";

function createSupabaseMock({
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
    expect(table).toBe("investor_wholesalers");

    return {
      insert,
      select,
      update,
      delete: deleteFn,
    };
  });

  return {
    from,
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

describe("InvestorWholesalerApplication", () => {
  it("creates an initial wholesaler form", () => {
    const application = new InvestorWholesalerApplication();

    expect(application.getInitialWholesalerForm()).toEqual({
      name: "",
      companyName: "",
      contactType: "",
      countiesServed: "",
      city: "",
      serviceArea: "",
      phone: "",
      email: "",
      websiteUrl: "",
      facebookUrl: "",
      dealTypes: "",
      buyerTypes: "",
      notes: "",
      communityContact: false,
    });
  });

  it("creates an investor wholesaler contact", async () => {
    const supabase = createSupabaseMock();
    const application = new InvestorWholesalerApplication({ supabase });

    const result = await application.createWholesaler({
      name: "409 Deals",
      companyName: "409 Wholesale",
      contactType: "Wholesaler",
      countiesServed: "Orange, Jefferson",
      city: "Orange",
      serviceArea: "Southeast Texas",
      phone: "409-555-0000",
      email: "deals@example.com",
      websiteUrl: "https://example.com",
      facebookUrl: "https://facebook.com/example",
      dealTypes: "off-market, fixer uppers",
      buyerTypes: "cash buyers, landlords",
      notes: "Local contact",
      communityContact: true,
    });

    expect(supabase.mocks.insert).toHaveBeenCalledWith([
      {
        name: "409 Deals",
        company_name: "409 Wholesale",
        contact_type: "Wholesaler",
        counties_served: "Orange, Jefferson",
        city: "Orange",
        service_area: "Southeast Texas",
        phone: "409-555-0000",
        email: "deals@example.com",
        website_url: "https://example.com",
        facebook_url: "https://facebook.com/example",
        deal_types: "off-market, fixer uppers",
        buyer_types: "cash buyers, landlords",
        notes: "Local contact",
        community_contact: true,
      },
    ]);

    expect(result).toEqual({
      ok: true,
      redirectTo: "/investors/wholesalers",
      message: "Wholesaler contact added",
    });
  });

  it("loads an investor wholesaler contact into a form", async () => {
    const supabase = createSupabaseMock({
      loadData: {
        name: "409 Deals",
        company_name: "409 Wholesale",
        contact_type: "Wholesaler",
        community_contact: true,
      },
    });

    const application = new InvestorWholesalerApplication({ supabase });

    const result = await application.loadWholesaler("wholesaler-1");

    expect(supabase.mocks.selectEq).toHaveBeenCalledWith(
      "id",
      "wholesaler-1",
    );
    expect(result.ok).toBe(true);
    expect(result.form).toMatchObject({
      name: "409 Deals",
      companyName: "409 Wholesale",
      contactType: "Wholesaler",
      communityContact: true,
      city: "",
    });
  });

  it("normalizes missing wholesaler contacts", async () => {
    const supabase = createSupabaseMock({
      loadData: null,
      loadError: { message: "Not found" },
    });

    const application = new InvestorWholesalerApplication({ supabase });

    const result = await application.loadWholesaler("missing-contact");

    expect(result).toEqual({
      ok: false,
      redirectTo: "/investors/wholesalers",
      message: "Wholesaler contact not found",
      error: { message: "Not found" },
    });
  });

  it("updates an investor wholesaler contact", async () => {
    const supabase = createSupabaseMock();
    const application = new InvestorWholesalerApplication({ supabase });

    const form = {
      ...application.getInitialWholesalerForm(),
      name: "Updated Contact",
      companyName: "Updated Company",
    };

    const result = await application.updateWholesaler({
      wholesalerId: "wholesaler-1",
      form,
    });

    expect(supabase.mocks.update).toHaveBeenCalledWith({
      name: "Updated Contact",
      company_name: "Updated Company",
      contact_type: "",
      counties_served: "",
      city: "",
      service_area: "",
      phone: "",
      email: "",
      website_url: "",
      facebook_url: "",
      deal_types: "",
      buyer_types: "",
      notes: "",
      community_contact: false,
    });

    expect(supabase.mocks.updateEq).toHaveBeenCalledWith(
      "id",
      "wholesaler-1",
    );
    expect(result).toEqual({
      ok: true,
      redirectTo: "/investors/wholesalers",
      message: "Wholesaler contact updated",
    });
  });

  it("deletes an investor wholesaler contact", async () => {
    const supabase = createSupabaseMock();
    const application = new InvestorWholesalerApplication({ supabase });

    const result = await application.deleteWholesaler("wholesaler-1");

    expect(supabase.mocks.deleteEq).toHaveBeenCalledWith(
      "id",
      "wholesaler-1",
    );
    expect(result).toEqual({
      ok: true,
      redirectTo: "/investors/wholesalers",
      message: "Wholesaler contact deleted",
    });
  });
});
