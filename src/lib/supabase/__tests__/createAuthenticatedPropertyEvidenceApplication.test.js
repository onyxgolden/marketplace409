import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate:
    vi.fn(),
  createRepository:
    vi.fn(),
}));

vi.mock(
  "../createAuthenticatedForgeApplication",
  () => ({
    createAuthenticatedForgeApplication:
      mocks.authenticate,
  }),
);

vi.mock(
  "@/infrastructure/composition",
  () => ({
    createPropertyEvidenceRepository:
      mocks.createRepository,
    PropertyEvidenceRepositoryStorage: {
      SUPABASE:
        "supabase",
    },
  }),
);

import {
  PropertyEvidenceApplication,
} from "@/application/property-evidence";

import {
  createAuthenticatedPropertyEvidenceApplication,
} from "../createAuthenticatedPropertyEvidenceApplication";

describe(
  "createAuthenticatedPropertyEvidenceApplication",
  () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it(
      "passes through authentication failure",
      async () => {
        const response =
          Response.json(
            {
              error:
                "Authentication required.",
            },
            {
              status: 401,
            },
          );

        mocks.authenticate
          .mockResolvedValue({
            response,
          });

        const result =
          await createAuthenticatedPropertyEvidenceApplication();

        expect(result.response)
          .toBe(response);

        expect(
          mocks.createRepository,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "composes owner-authenticated metadata and private storage",
      async () => {
        const repository = {
          save:
            vi.fn(),
        };

        const storage = {
          from:
            vi.fn(),
        };

        const supabaseClient = {
          from:
            vi.fn(),
          storage,
        };

        mocks.authenticate
          .mockResolvedValue({
            supabaseClient,
            user: {
              id:
                "owner_1",
            },
          });

        mocks.createRepository
          .mockResolvedValue(
            repository,
          );

        const result =
          await createAuthenticatedPropertyEvidenceApplication();

        expect(
          mocks.createRepository,
        ).toHaveBeenCalledWith({
          storage:
            "supabase",
          supabaseClient,
        });

        expect(
          result.application,
        ).toBeInstanceOf(
          PropertyEvidenceApplication,
        );

        expect(
          result.application
            .repository,
        ).toBe(repository);

        expect(
          result.application
            .storage,
        ).toBe(storage);

        expect(result.user).toEqual({
          id: "owner_1",
        });
      },
    );
  },
);
