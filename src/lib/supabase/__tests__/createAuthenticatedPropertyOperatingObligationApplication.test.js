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
  createRepository:
    vi.fn(),
  findByOwnerId:
    vi.fn(),
  buildWorkspace:
    vi.fn(),
}));

vi.mock(
  "@/lib/supabase/createAuthenticatedForgeApplication",
  () => ({
    createAuthenticatedForgeApplication:
      mocks.createAuthenticatedForgeApplication,
  }),
);

vi.mock(
  "@/infrastructure/composition/createPropertyOperatingObligationRepository.js",
  () => ({
    createPropertyOperatingObligationRepository:
      mocks.createRepository,
  }),
);

import {
  createAuthenticatedPropertyOperatingObligationApplication,
} from "../createAuthenticatedPropertyOperatingObligationApplication.js";

describe(
  "createAuthenticatedPropertyOperatingObligationApplication",
  () => {
    beforeEach(() => {
      vi.clearAllMocks();

      mocks.createRepository
        .mockResolvedValue({
          save: vi.fn(),
          saveMany: vi.fn(),
          findById: vi.fn(),
          list: vi.fn(),
        });

      mocks.findByOwnerId
        .mockResolvedValue([
          {
            id:
              "financial_event_1",
          },
        ]);

      mocks.buildWorkspace
        .mockResolvedValue({
          properties: [
            {
              propertyId:
                "1214-wagner",
              propertyName:
                "1214 Wagner",
            },
          ],
        });

      const supabaseClient = {};

      mocks.createAuthenticatedForgeApplication
        .mockResolvedValue({
          supabaseClient,
          user: {
            id: "owner_1",
          },
          getForgeApplicationSuite:
            vi.fn(
              async () => ({
                financialApplicationSuite: {
                  financialEventRepository: {
                    findByOwnerId:
                      mocks.findByOwnerId,
                  },
                  financialWorkspaceQueryService: {
                    buildWorkspace:
                      mocks.buildWorkspace,
                  },
                },
              }),
            ),
        });
    });

    it(
      "passes through authentication failure",
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

        await expect(
          createAuthenticatedPropertyOperatingObligationApplication(),
        ).resolves.toEqual({
          response,
        });

        expect(
          mocks.createRepository,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "creates the Supabase obligation application",
      async () => {
        const authenticated =
          await createAuthenticatedPropertyOperatingObligationApplication();

        expect(
          mocks.createRepository,
        ).toHaveBeenCalledWith({
          storage: "supabase",
          supabaseClient:
            authenticated
              .supabaseClient,
        });
        expect(
          typeof authenticated
            .application
            .importSpreadsheet,
        ).toBe("function");
      },
    );

    it(
      "loads properties and financial events through owner authority",
      async () => {
        const authenticated =
          await createAuthenticatedPropertyOperatingObligationApplication();

        const context =
          await authenticated
            .loadImportContext();

        expect(
          context.properties,
        ).toEqual([
          {
            id:
              "1214-wagner",
            propertyId:
              "1214-wagner",
            name:
              "1214 Wagner",
          },
        ]);
        expect(
          context.financialEvents,
        ).toEqual([
          {
            id:
              "financial_event_1",
          },
        ]);
        expect(
          mocks.findByOwnerId,
        ).toHaveBeenCalledWith(
          "owner_1",
        );
        expect(
          Object.isFrozen(
            context.properties,
          ),
        ).toBe(true);
      },
    );

    it(
      "propagates canonical property catalog failures",
      async () => {
        mocks.buildWorkspace
          .mockRejectedValue(
            new Error(
              "Property load failed.",
            ),
          );

        const authenticated =
          await createAuthenticatedPropertyOperatingObligationApplication();

        await expect(
          authenticated
            .loadImportContext(),
        ).rejects.toThrow(
          "Property load failed.",
        );
      },
    );
  },
);
