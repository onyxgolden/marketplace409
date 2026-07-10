import { describe, expect, it, vi } from "vitest";

import { InvestorCashBuyerApplication } from "./InvestorCashBuyerApplication";

function createSupabaseMock({
  loadData = null,
  loadError = null,
  insertError = null,
  updateError = null,
} = {}) {
  const insert = vi.fn(async () => ({ error: insertError }));
  const updateEq = vi.fn(async () => ({ error: updateError }));
  const update = vi.fn(() => ({ eq: updateEq }));
  const single = vi.fn(async () => ({ data: loadData, error: loadError }));
  const selectEq = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ eq: selectEq }));

  const from = vi.fn((table) => {
    expect(table).toBe("cash_buyers");

    return {
      insert,
      select,
      update,
    };
  });

  return {
    from,
    mocks: {
      insert,
      update,
      updateEq,
      select,
      selectEq,
      single,
    },
  };
}

describe("InvestorCashBuyerApplication", () => {
  it("creates an initial cash buyer form", () => {
    const application = new InvestorCashBuyerApplication();

    expect(application.getInitialCashBuyerForm()).toEqual({
      name: "",
      company_name: "",
      email: "",
      phone: "",
      cities: "",
      property_types: "",
      max_price: "",
      funding_type: "",
      notes: "",
    });
  });

  it("creates an investor cash buyer", async () => {
    const supabase = createSupabaseMock();
    const application = new InvestorCashBuyerApplication({ supabase });

    const result = await application.createCashBuyer({
      name: "Jason Morgan",
      company_name: "409 Investments",
      email: "jason@example.com",
      phone: "409-555-0000",
      cities: "Orange, Vidor",
      property_types: "Single family, duplex",
      max_price: "$250,000",
      funding_type: "Cash",
      notes: "Can close quickly",
    });

    expect(supabase.mocks.insert).toHaveBeenCalledWith([
      {
        name: "Jason Morgan",
        company_name: "409 Investments",
        email: "jason@example.com",
        phone: "409-555-0000",
        cities: "Orange, Vidor",
        property_types: "Single family, duplex",
        max_price: "$250,000",
        funding_type: "Cash",
        notes: "Can close quickly",
        is_active: true,
      },
    ]);

    expect(result).toEqual({
      ok: true,
      submitted: true,
      message: "Cash buyer added",
    });
  });

  it("loads an investor cash buyer into a form", async () => {
    const supabase = createSupabaseMock({
      loadData: {
        name: "Jason Morgan",
        company_name: "409 Investments",
        email: "jason@example.com",
        phone: "409-555-0000",
      },
    });

    const application = new InvestorCashBuyerApplication({ supabase });

    const result = await application.loadCashBuyer("buyer-1");

    expect(supabase.mocks.selectEq).toHaveBeenCalledWith("id", "buyer-1");
    expect(result.ok).toBe(true);
    expect(result.form).toMatchObject({
      name: "Jason Morgan",
      company_name: "409 Investments",
      email: "jason@example.com",
      phone: "409-555-0000",
      cities: "",
      property_types: "",
    });
  });

  it("normalizes missing cash buyers", async () => {
    const supabase = createSupabaseMock({
      loadData: null,
      loadError: { message: "Not found" },
    });

    const application = new InvestorCashBuyerApplication({ supabase });

    const result = await application.loadCashBuyer("missing-buyer");

    expect(result).toEqual({
      ok: false,
      message: "Not found",
      error: { message: "Not found" },
    });
  });

  it("updates an investor cash buyer", async () => {
    const supabase = createSupabaseMock();
    const application = new InvestorCashBuyerApplication({ supabase });

    const form = {
      ...application.getInitialCashBuyerForm(),
      name: "Updated Buyer",
      company_name: "Updated Investments",
    };

    const result = await application.updateCashBuyer({
      buyerId: "buyer-1",
      form,
    });

    expect(supabase.mocks.update).toHaveBeenCalledWith({
      name: "Updated Buyer",
      company_name: "Updated Investments",
      email: "",
      phone: "",
      cities: "",
      property_types: "",
      max_price: "",
      funding_type: "",
      notes: "",
    });

    expect(supabase.mocks.updateEq).toHaveBeenCalledWith("id", "buyer-1");

    expect(result).toEqual({
      ok: true,
      redirectTo: "/investors/cash-buyers",
      message: "Cash buyer updated",
    });
  });

  it("soft deletes an investor cash buyer", async () => {
    const supabase = createSupabaseMock();
    const application = new InvestorCashBuyerApplication({ supabase });

    const result = await application.deleteCashBuyer("buyer-1");

    expect(supabase.mocks.update).toHaveBeenCalledWith({
      is_active: false,
    });

    expect(supabase.mocks.updateEq).toHaveBeenCalledWith("id", "buyer-1");

    expect(result).toEqual({
      ok: true,
      redirectTo: "/investors/cash-buyers",
      message: "Cash buyer removed",
    });
  });
});
