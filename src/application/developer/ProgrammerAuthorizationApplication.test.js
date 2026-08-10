import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  DEFAULT_PROGRAMMER_EMAIL,
  ProgrammerAuthorizationApplication,
} from "./ProgrammerAuthorizationApplication";

function createSupabase({
  user = {
    id: "programmer-1",
    email:
      DEFAULT_PROGRAMMER_EMAIL,
  },
  error = null,
} = {}) {
  return {
    auth: {
      getUser:
        vi.fn().mockResolvedValue({
          data: {
            user,
          },
          error,
        }),
    },
  };
}

describe(
  "ProgrammerAuthorizationApplication",
  () => {
    it(
      "authorizes the configured programmer",
      async () => {
        const application =
          new ProgrammerAuthorizationApplication({
            supabase:
              createSupabase(),
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
      "normalizes the configured email",
      async () => {
        const application =
          new ProgrammerAuthorizationApplication({
            supabase:
              createSupabase({
                user: {
                  id: "programmer-1",
                  email:
                    "JASONMORGAN99@GMAIL.COM",
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
      "rejects another authenticated user",
      async () => {
        const application =
          new ProgrammerAuthorizationApplication({
            supabase:
              createSupabase({
                user: {
                  id: "user-2",
                  email:
                    "someone@example.com",
                },
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
            supabase:
              createSupabase({
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
      "normalizes authentication failures",
      async () => {
        const application =
          new ProgrammerAuthorizationApplication({
            supabase:
              createSupabase({
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
