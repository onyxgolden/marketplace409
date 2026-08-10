import {
  renderToStaticMarkup,
} from "react-dom/server";

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
    notFound:
      vi.fn(() => {
        throw new Error(
          "NEXT_NOT_FOUND",
        );
      }),
  }));

vi.mock(
  "@/lib/supabase/loadProgrammerAuthorization",
  () => ({
    loadProgrammerAuthorization:
      mocks.loadProgrammerAuthorization,
  }),
);

vi.mock(
  "next/navigation",
  () => ({
    notFound:
      mocks.notFound,
  }),
);

import ForgeDeveloperPage from "./page";

describe(
  "ForgeDeveloperPage",
  () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it(
      "renders for the authorized programmer",
      async () => {
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

        const page =
          await ForgeDeveloperPage();

        const markup =
          renderToStaticMarkup(
            page,
          );

        expect(markup).toContain(
          "FORGE Programmer Dashboard",
        );
      },
    );

    it(
      "returns not found for another user",
      async () => {
        mocks
          .loadProgrammerAuthorization
          .mockResolvedValue({
            ok: true,
            authorized: false,
            user: {
              id: "user-2",
              email:
                "someone@example.com",
            },
          });

        await expect(
          ForgeDeveloperPage(),
        ).rejects.toThrow(
          "NEXT_NOT_FOUND",
        );

        expect(
          mocks.notFound,
        ).toHaveBeenCalledOnce();
      },
    );
  },
);
