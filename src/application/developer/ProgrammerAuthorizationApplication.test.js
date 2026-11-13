import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  ProgrammerAuthorizationApplication,
} from "./ProgrammerAuthorizationApplication";

// SaaS Auth PR 1: authorization is a stable-user-ID grant
// (forge_is_programmer), never an email comparison. The mock
// supabase therefore carries rpc() alongside auth.getUser().
function createSupabase({
  user = { id: "programmer-1", email: "someone@example.com" },
  error = null,
  isProgrammer = true,
  rpcError = null,
  withRpc = true,
} = {}) {
  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error,
      }),
    },
  };
  if (withRpc) {
    supabase.rpc = vi.fn(async (name) => {
      expect(name).toBe("forge_is_programmer");
      return { data: isProgrammer, error: rpcError };
    });
  }
  return supabase;
}

describe(
  "ProgrammerAuthorizationApplication",
  () => {
    it(
      "authorizes a user holding an active programmer grant",
      async () => {
        const application =
          new ProgrammerAuthorizationApplication({
            supabase: createSupabase(),
          });

        await expect(
          application.loadAuthorization(),
        ).resolves.toMatchObject({
          ok: true,
          authorized: true,
          user: {
            id: "programmer-1",
          },
        });
      },
    );

    it(
      "authorizes by grant even when the email is not the old default",
      async () => {
        const application =
          new ProgrammerAuthorizationApplication({
            supabase: createSupabase({
              user: {
                id: "programmer-1",
                email: "JASONMORGAN99@GMAIL.COM",
              },
            }),
          });

        await expect(
          application.loadAuthorization(),
        ).resolves.toMatchObject({
          authorized: true,
        });
      },
    );

    it(
      "rejects an authenticated user with no programmer grant",
      async () => {
        const application =
          new ProgrammerAuthorizationApplication({
            supabase: createSupabase({
              user: {
                id: "user-2",
                email: "someone@example.com",
              },
              isProgrammer: false,
            }),
          });

        await expect(
          application.loadAuthorization(),
        ).resolves.toMatchObject({
          ok: true,
          authorized: false,
        });
      },
    );

    it(
      "rejects an unauthenticated request",
      async () => {
        const application =
          new ProgrammerAuthorizationApplication({
            supabase: createSupabase({
              user: null,
            }),
          });

        await expect(
          application.loadAuthorization(),
        ).resolves.toMatchObject({
          authorized: false,
          user: null,
        });
      },
    );

    it(
      "fails closed when the grant check errors",
      async () => {
        const application =
          new ProgrammerAuthorizationApplication({
            supabase: createSupabase({
              rpcError: new Error("boom"),
            }),
          });

        await expect(
          application.loadAuthorization(),
        ).resolves.toMatchObject({
          ok: false,
          authorized: false,
        });
      },
    );

    it(
      "normalizes authentication failures",
      async () => {
        const application =
          new ProgrammerAuthorizationApplication({
            supabase: createSupabase({
              error: {
                message:
                  "Authentication failed.",
              },
            }),
          });

        await expect(
          application.loadAuthorization(),
        ).resolves.toEqual({
          ok: false,
          authorized: false,
          user: null,
          message:
            "Authentication failed.",
        });
      },
    );
  },
);
