import {
  afterEach,
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
    buildSessionCloseoutProposal:
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
  "../../../../../../../scripts/governance/buildSessionCloseoutProposal.mjs",
  () => ({
    buildSessionCloseoutProposal:
      mocks.buildSessionCloseoutProposal,
  }),
);

import {
  GET,
} from "./route";

describe(
  "GET /api/forge/developer/commands/closeout-proposal",
  () => {
    const originalVercelEnvironment =
      process.env.VERCEL;

    beforeEach(() => {
      vi.clearAllMocks();
      delete process.env.VERCEL;

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
        .buildSessionCloseoutProposal
        .mockReturnValue({
          phase: {
            identifier: "16.9",
            title: "Reviewed closeout proposal",
          },
          deliveredWork: [
            "feat: add proposal builder",
          ],
        });
    });

    afterEach(() => {
      if (
        originalVercelEnvironment ===
        undefined
      ) {
        delete process.env.VERCEL;
      } else {
        process.env.VERCEL =
          originalVercelEnvironment;
      }
    });

    it(
      "returns a deterministic proposal for the authorized programmer",
      async () => {
        const response = await GET();

        expect(
          response.status,
        ).toBe(200);

        await expect(
          response.json(),
        ).resolves.toEqual({
          proposal: {
            phase: {
              identifier: "16.9",
              title:
                "Reviewed closeout proposal",
            },
            deliveredWork: [
              "feat: add proposal builder",
            ],
          },
        });

        expect(
          mocks.buildSessionCloseoutProposal,
        ).toHaveBeenCalledTimes(1);
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

        const response = await GET();

        expect(
          response.status,
        ).toBe(403);

        expect(
          mocks.buildSessionCloseoutProposal,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "refuses to build a proposal on Vercel",
      async () => {
        process.env.VERCEL = "1";

        const response = await GET();

        expect(
          response.status,
        ).toBe(400);

        await expect(
          response.json(),
        ).resolves.toMatchObject({
          error:
            expect.stringContaining(
              "disabled on Vercel",
            ),
        });

        expect(
          mocks.buildSessionCloseoutProposal,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "normalizes proposal-building failures",
      async () => {
        mocks
          .buildSessionCloseoutProposal
          .mockImplementation(() => {
            throw new Error(
              "Governance state could not be read.",
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

        const response = await GET();

        expect(
          response.status,
        ).toBe(500);

        await expect(
          response.json(),
        ).resolves.toEqual({
          error:
            "Governance state could not be read.",
        });

        consoleError.mockRestore();
      },
    );
  },
);
