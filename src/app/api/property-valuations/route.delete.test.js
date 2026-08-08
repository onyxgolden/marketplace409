import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  createAuthenticatedPropertyValuationApplication:
    vi.fn(),
  remove:
    vi.fn(),
}));

vi.mock(
  "@/lib/supabase/createAuthenticatedPropertyValuationApplication",
  () => ({
    createAuthenticatedPropertyValuationApplication:
      mocks.createAuthenticatedPropertyValuationApplication,
  }),
);

import {
  DELETE,
} from "./route";

function createRequest(body) {
  return new Request(
    "http://localhost/api/property-valuations",
    {
      method:
        "DELETE",
      body:
        JSON.stringify(body),
    },
  );
}

function authenticate() {
  mocks.createAuthenticatedPropertyValuationApplication
    .mockResolvedValue({
      user: {
        id:
          "authenticated-owner",
      },
      application: {
        remove:
          mocks.remove,
      },
    });
}

describe(
  "DELETE /api/property-valuations",
  () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it(
      "uses only authenticated owner authority",
      async () => {
        authenticate();

        const valuation = {
          id:
            "valuation-1",
          propertyId:
            "vincent",
        };

        mocks.remove
          .mockResolvedValue(
            valuation,
          );

        const response =
          await DELETE(
            createRequest({
              valuationId:
                "valuation-1",
              ownerId:
                "spoofed-owner",
            }),
          );

        expect(
          mocks.remove,
        ).toHaveBeenCalledWith(
          "valuation-1",
          "authenticated-owner",
        );

        expect(response.status).toBe(
          200,
        );

        await expect(
          response.json(),
        ).resolves.toEqual({
          success:
            true,
          valuation,
        });
      },
    );

    it(
      "returns not found without exposing ownership",
      async () => {
        authenticate();

        mocks.remove
          .mockResolvedValue(
            null,
          );

        const response =
          await DELETE(
            createRequest({
              valuationId:
                "valuation-1",
            }),
          );

        expect(response.status).toBe(
          404,
        );

        await expect(
          response.json(),
        ).resolves.toEqual({
          error:
            "Property valuation was not found.",
        });
      },
    );

    it(
      "passes through authentication failure",
      async () => {
        const authenticationResponse =
          Response.json(
            {
              error:
                "Authenticated owner id is required.",
            },
            {
              status:
                401,
            },
          );

        mocks.createAuthenticatedPropertyValuationApplication
          .mockResolvedValue({
            response:
              authenticationResponse,
          });

        const response =
          await DELETE(
            createRequest({
              valuationId:
                "valuation-1",
            }),
          );

        expect(response).toBe(
          authenticationResponse,
        );

        expect(
          mocks.remove,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects a missing valuation id",
      async () => {
        authenticate();

        const response =
          await DELETE(
            createRequest({}),
          );

        expect(response.status).toBe(
          400,
        );

        expect(
          mocks.remove,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
