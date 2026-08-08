import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  createAuthenticatedForgeApplication:
    vi.fn(),
  createPropertyHVACRepository:
    vi.fn(),
}));

vi.mock(
  "../createAuthenticatedForgeApplication",
  () => ({
    createAuthenticatedForgeApplication:
      mocks.createAuthenticatedForgeApplication,
  }),
);

vi.mock(
  "@/infrastructure/composition",
  () => ({
    createPropertyHVACRepository:
      mocks.createPropertyHVACRepository,
  }),
);

import {
  PropertyHVACApplication,
} from "@/application/property-hvac";

import {
  createAuthenticatedPropertyHVACApplication,
} from "../createAuthenticatedPropertyHVACApplication";

describe(
  "createAuthenticatedPropertyHVACApplication",
  () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it(
      "returns authentication failure without composing HVAC services",
      async () => {
        const response =
          Response.json(
            {
              error:
                "Authenticated owner id is required.",
            },
            {
              status: 401,
            },
          );

        mocks.createAuthenticatedForgeApplication
          .mockResolvedValue({
            response,
          });

        const result =
          await createAuthenticatedPropertyHVACApplication();

        expect(
          result.response,
        ).toBe(response);

        expect(
          mocks.createPropertyHVACRepository,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "awaits explicit authenticated Supabase composition",
      async () => {
        const supabaseClient = {
          from:
            vi.fn(),
        };

        const repository = {
          saveSystem:
            vi.fn(),
        };

        mocks.createAuthenticatedForgeApplication
          .mockResolvedValue({
            supabaseClient,
            user: {
              id:
                "authenticated-owner",
            },
          });

        mocks.createPropertyHVACRepository
          .mockResolvedValue(
            repository,
          );

        const result =
          await createAuthenticatedPropertyHVACApplication();

        expect(
          mocks.createPropertyHVACRepository,
        ).toHaveBeenCalledWith({
          storage:
            "supabase",
          supabaseClient,
        });

        expect(
          result.application,
        ).toBeInstanceOf(
          PropertyHVACApplication,
        );

        expect(
          result.application.repository,
        ).toBe(repository);

        expect(result.user).toEqual({
          id:
            "authenticated-owner",
        });
      },
    );
  },
);
