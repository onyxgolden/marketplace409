import { describe, expect, it, vi } from "vitest";

import { BusinessCreateApplication } from "./BusinessCreateApplication";

function createSupabaseMock({ insertError = null } = {}) {
  const insert = vi.fn(async () => ({
    error: insertError,
  }));

  const from = vi.fn((table) => {
    expect(table).toBe("businesses");

    return {
      insert,
    };
  });

  return {
    from,
    mocks: {
      from,
      insert,
    },
  };
}

describe("BusinessCreateApplication", () => {
  it("creates an initial business create form", () => {
    const application = new BusinessCreateApplication();

    expect(application.getInitialBusinessCreateForm()).toEqual({
      name: "",
      address: "",
    });
  });

  it("creates independent initial forms", () => {
    const application = new BusinessCreateApplication();

    const firstForm = application.getInitialBusinessCreateForm();
    const secondForm = application.getInitialBusinessCreateForm();

    firstForm.name = "409 Roofing";

    expect(secondForm).toEqual({
      name: "",
      address: "",
    });
  });

  it("creates a business", async () => {
    const supabase = createSupabaseMock();
    const application = new BusinessCreateApplication({ supabase });

    const result = await application.createBusiness({
      name: "409 Roofing",
      address: "170 John Street",
    });

    expect(supabase.mocks.from).toHaveBeenCalledWith("businesses");
    expect(supabase.mocks.insert).toHaveBeenCalledWith([
      {
        name: "409 Roofing",
        address: "170 John Street",
      },
    ]);

    expect(result).toEqual({
      ok: true,
      redirectTo: "/businesses",
      message: "Business created!",
    });
  });

  it("normalizes business creation failures", async () => {
    const insertError = {
      message: "Insert failed",
    };

    const supabase = createSupabaseMock({ insertError });
    const application = new BusinessCreateApplication({ supabase });

    const result = await application.createBusiness({
      name: "409 Roofing",
      address: "170 John Street",
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
    const application = new BusinessCreateApplication({ supabase });

    const result = await application.createBusiness(
      application.getInitialBusinessCreateForm(),
    );

    expect(result).toEqual({
      ok: false,
      message: "Failed to create business",
      error: insertError,
    });
  });
});
