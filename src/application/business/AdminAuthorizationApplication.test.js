import { describe, expect, it, vi } from "vitest";

import { AdminAuthorizationApplication } from "./AdminAuthorizationApplication";

function createSupabaseMock({
  user = {
    id: "user-1",
    email: "jasonmorgan99@gmail.com",
  },
  authenticationError = null,
} = {}) {
  const getUser = vi.fn(async () => ({
    data: {
      user,
    },
    error: authenticationError,
  }));

  return {
    auth: {
      getUser,
    },
    mocks: {
      getUser,
    },
  };
}

describe("AdminAuthorizationApplication", () => {
  it("recognizes the administrator", async () => {
    const supabase = createSupabaseMock();

    const application = new AdminAuthorizationApplication({
      supabase,
    });

    const result = await application.loadAdminAuthorization();

    expect(supabase.mocks.getUser).toHaveBeenCalledOnce();

    expect(result).toEqual(
      Object.freeze({
        ok: true,
        authorized: true,
        isAdmin: true,
        user: {
          id: "user-1",
          email: "jasonmorgan99@gmail.com",
        },
      }),
    );
  });

  it("recognizes a non-administrator", async () => {
    const supabase = createSupabaseMock({
      user: {
        id: "user-2",
        email: "someone@example.com",
      },
    });

    const application = new AdminAuthorizationApplication({
      supabase,
    });

    const result = await application.loadAdminAuthorization();

    expect(result).toEqual(
      Object.freeze({
        ok: true,
        authorized: false,
        isAdmin: false,
        user: {
          id: "user-2",
          email: "someone@example.com",
        },
      }),
    );
  });

  it("handles an unauthenticated user", async () => {
    const supabase = createSupabaseMock({
      user: null,
    });

    const application = new AdminAuthorizationApplication({
      supabase,
    });

    const result = await application.loadAdminAuthorization();

    expect(result).toEqual(
      Object.freeze({
        ok: true,
        authorized: false,
        isAdmin: false,
        user: null,
      }),
    );
  });

  it("normalizes authentication failures", async () => {
    const authenticationError = {
      message: "Authentication failed",
    };

    const supabase = createSupabaseMock({
      authenticationError,
    });

    const application = new AdminAuthorizationApplication({
      supabase,
    });

    const result = await application.loadAdminAuthorization();

    expect(result).toEqual(
      Object.freeze({
        ok: false,
        authorized: false,
        isAdmin: false,
        user: null,
        message: "Authentication failed",
        error: authenticationError,
      }),
    );
  });
});

Object.freeze(createSupabaseMock);
