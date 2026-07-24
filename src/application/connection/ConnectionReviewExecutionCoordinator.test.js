import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  ConnectionReviewExecutionCoordinator,
} from "./ConnectionReviewExecutionCoordinator.js";

describe(
  "ConnectionReviewExecutionCoordinator",
  () => {
    it(
      "reviews an authenticated connection deterministically",
      async () => {
        const connection = Object.freeze({
          id: "connection-1",
          userId: "owner-1",
          name: "Primary Bank",
          type: "bank",
          status: "connected",
          provider: "plaid",
          credentialReferenceId:
            "credential-1",
          createdAt:
            "2026-07-20T01:00:00.000Z",
          updatedAt:
            "2026-07-24T01:00:00.000Z",
        });

        const credentialReference =
          Object.freeze({
            id: "credential-1",
            provider: "plaid",
            connectionId:
              "connection-1",
          });

        const institutionReference =
          Object.freeze({
            id: "institution-1",
            connectionId:
              "connection-1",
            provider: "plaid",
            institutionId:
              "institution-1",
            institutionName:
              "Primary Bank",
          });

        const connectionRepository = {
          getById:
            vi.fn().mockResolvedValue(
              connection,
            ),
        };

        const credentialReferenceRepository =
          {
            getById:
              vi.fn().mockResolvedValue(
                credentialReference,
              ),
          };

        const institutionReferenceRepository =
          {
            getAll:
              vi.fn().mockResolvedValue([
                institutionReference,
              ]),
          };

        const coordinator =
          new ConnectionReviewExecutionCoordinator({
            connectionRepository,
            credentialReferenceRepository,
            institutionReferenceRepository,
          });

        const result =
          await coordinator.executeReview({
            connectionId:
              "connection-1",
            ownerId: "owner-1",
          });

        expect(result).toEqual({
          type:
            "connection-review-execution",
          connectionId:
            "connection-1",
          ownerId: "owner-1",
          provider: "plaid",
          status: "connected",
          severity: "healthy",
          allowsImport: true,
          requiresUserAction: false,
          recommendedOperation:
            "import-transactions",
        });

        expect(
          Object.isFrozen(result),
        ).toBe(true);

        expect(
          connectionRepository.getById,
        ).toHaveBeenCalledWith(
          "connection-1",
          Object.freeze({
            ownerId: "owner-1",
          }),
        );

        expect(
          credentialReferenceRepository
            .getById,
        ).toHaveBeenCalledWith(
          "credential-1",
          Object.freeze({
            ownerId: "owner-1",
          }),
        );

        expect(
          institutionReferenceRepository
            .getAll,
        ).toHaveBeenCalledWith(
          Object.freeze({
            ownerId: "owner-1",
          }),
        );
      },
    );

    it(
      "rejects an unknown authenticated connection",
      async () => {
        const coordinator =
          new ConnectionReviewExecutionCoordinator({
            connectionRepository: {
              getById:
                vi.fn().mockResolvedValue(
                  null,
                ),
            },
            credentialReferenceRepository:
              {},
            institutionReferenceRepository:
              {},
          });

        await expect(
          coordinator.executeReview({
            connectionId: "missing",
            ownerId: "owner-1",
          }),
        ).rejects.toThrow(
          "Connection not found for review execution.",
        );
      },
    );
  },
);
