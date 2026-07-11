import { describe, expect, it, vi } from "vitest";

import { BusinessDeleteApplication } from "./BusinessDeleteApplication";

function createSupabaseMock({ deleteError = null } = {}) {
  const deleteEq = vi.fn(async () => ({
    error: deleteError,
  }));

  const deleteOperation = vi.fn(() => ({
    eq: deleteEq,
  }));

  const from = vi.fn((table) => {
    expect(table).toBe("businesses");

    return {
      delete: deleteOperation,
    };
  });

  return {
    from,
    mocks: {
      from,
      deleteOperation,
      deleteEq,
    },
  };
}

describe("BusinessDeleteApplication", () => {
  it("deletes a business", async () => {
    const supabase = createSupabaseMock();

    const application = new BusinessDeleteApplication({
      supabase,
    });

    const result = await application.deleteBusiness({
      businessId: "business-1",
    });

    expect(supabase.mocks.from).toHaveBeenCalledWith("businesses");
    expect(supabase.mocks.deleteEq).toHaveBeenCalledWith(
      "id",
      "business-1",
    );

    expect(result).toEqual({
      ok: true,
      reload: true,
      message: "Business deleted",
    });
  });

  it("normalizes delete failures", async () => {
    const deleteError = {
      message: "Delete failed",
    };

    const supabase = createSupabaseMock({
      deleteError,
    });

    const application = new BusinessDeleteApplication({
      supabase,
    });

    const result = await application.deleteBusiness({
      businessId: "business-1",
    });

    expect(result).toEqual({
      ok: false,
      message: "Delete failed",
      error: deleteError,
    });
  });

  it("provides a fallback delete error message", async () => {
    const deleteError = {};

    const supabase = createSupabaseMock({
      deleteError,
    });

    const application = new BusinessDeleteApplication({
      supabase,
    });

    const result = await application.deleteBusiness({
      businessId: "business-1",
    });

    expect(result).toEqual({
      ok: false,
      message: "Error deleting business",
      error: deleteError,
    });
  });
});
