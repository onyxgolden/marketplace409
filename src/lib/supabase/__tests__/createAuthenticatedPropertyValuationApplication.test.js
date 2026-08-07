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
  createPropertyValuationRepository:
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
    createPropertyValuationRepository:
      mocks.createPropertyValuationRepository,
  }),
);

import {
  PropertyValuationApplication,
} from "@/application/property-valuation";
import {
  createAuthenticatedPropertyValuationApplication,
} from "../createAuthenticatedPropertyValuationApplication";

describe(
  "createAuthenticatedPropertyValuationApplication",
  () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it(
      "returns the authentication response without composing valuation services",
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
          await createAuthenticatedPropertyValuationApplication();

        expect(result.response).toBe(
          response,
        );

        expect(
          mocks.createPropertyValuationRepository,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "composes an owner-authenticated valuation application",
      async () => {
        const supabaseClient = {
          from:
            vi.fn(),
        };

        const repository = {
          save:
            vi.fn(),
          saveMany:
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

        mocks.createPropertyValuationRepository
          .mockReturnValue(
            repository,
          );

        const result =
          await createAuthenticatedPropertyValuationApplication();

        expect(
          mocks.createPropertyValuationRepository,
        ).toHaveBeenCalledWith({
          supabaseClient,
        });

        expect(result.user).toEqual({
          id:
            "authenticated-owner",
        });

        expect(
          result.application,
        ).toBeInstanceOf(
          PropertyValuationApplication,
        );

        expect(
          result.application.repository,
        ).toBe(repository);
      },
    );
  },
);
