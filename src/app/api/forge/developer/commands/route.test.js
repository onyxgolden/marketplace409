import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks =
  vi.hoisted(() => ({
    loadProgrammerAuthorization:
      vi.fn(),
    executeProgrammerCommand:
      vi.fn(),
  }));

vi.mock(
  "@/lib/supabase/loadProgrammerAuthorization",
  () => ({
    loadProgrammerAuthorization:
      mocks.loadProgrammerAuthorization,
  }),
);

vi.mock(
  "@/infrastructure/developer/executeProgrammerCommand",
  () => ({
    executeProgrammerCommand:
      mocks.executeProgrammerCommand,
  }),
);

import {
  maxDuration,
  POST,
} from "./route";

function request(
  commandId,
  reviewedMetadata,
) {
  return new Request(
    "http://localhost/api/forge/developer/commands",
    {
      method: "POST",
      headers: {
        "content-type":
          "application/json",
      },
      body:
        JSON.stringify({
          commandId,
          ...(reviewedMetadata !==
            undefined
            ? { reviewedMetadata }
            : {}),
        }),
    },
  );
}

describe(
  "POST /api/forge/developer/commands",
  () => {
    it(
      "stays within the Vercel Hobby serverless duration limit",
      () => {
        expect(maxDuration)
          .toBeLessThanOrEqual(300);
      },
    );

    beforeEach(() => {
      vi.clearAllMocks();

      mocks
        .loadProgrammerAuthorization
        .mockResolvedValue({
          ok: true,
          authorized: true,
          user: {
            id: "programmer-1",
            email:
              "jasonmorgan99@gmail.com",
          },
        });

      mocks
        .executeProgrammerCommand
        .mockReturnValue({
          commandId:
            "repository-status",
          label:
            "Check repository",
          status:
            "passing",
          steps: [],
        });
    });

    it(
      "executes an allowlisted command for the programmer",
      async () => {
        const response =
          await POST(
            request(
              "repository-status",
            ),
          );

        expect(
          response.status,
        ).toBe(200);

        await expect(
          response.json(),
        ).resolves.toMatchObject({
          success: true,
          result: {
            commandId:
              "repository-status",
            status:
              "passing",
          },
        });

        expect(
          mocks.executeProgrammerCommand,
        ).toHaveBeenCalledWith({
          commandId:
            "repository-status",
        });
      },
    );

    it(
      "forwards reviewed session metadata to the executor when supplied",
      async () => {
        const reviewedMetadata = {
          phaseIdentifier: "Phase 16",
          markSessionComplete: false,
        };

        const response =
          await POST(
            request(
              "complete-session-closeout",
              reviewedMetadata,
            ),
          );

        expect(
          response.status,
        ).toBe(200);

        expect(
          mocks.executeProgrammerCommand,
        ).toHaveBeenCalledWith({
          commandId:
            "complete-session-closeout",
          reviewedMetadata,
        });
      },
    );

    it(
      "rejects another authenticated user",
      async () => {
        mocks
          .loadProgrammerAuthorization
          .mockResolvedValue({
            ok: true,
            authorized: false,
            user: {
              id: "user-2",
            },
          });

        const response =
          await POST(
            request(
              "repository-status",
            ),
          );

        expect(
          response.status,
        ).toBe(403);

        expect(
          mocks.executeProgrammerCommand,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects commands outside the registry",
      async () => {
        const response =
          await POST(
            request(
              "arbitrary-shell-command",
            ),
          );

        expect(
          response.status,
        ).toBe(400);

        expect(
          mocks.executeProgrammerCommand,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "normalizes execution failures",
      async () => {
        mocks
          .executeProgrammerCommand
          .mockImplementation(() => {
            throw new Error(
              "Local execution failed.",
            );
          });

        const consoleError =
          vi.spyOn(
            console,
            "error",
          )
            .mockImplementation(
              () => {},
            );

        const response =
          await POST(
            request(
              "repository-status",
            ),
          );

        expect(
          response.status,
        ).toBe(500);

        await expect(
          response.json(),
        ).resolves.toEqual({
          error:
            "Local execution failed.",
        });

        consoleError
          .mockRestore();
      },
    );
  },
);
