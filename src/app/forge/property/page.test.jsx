import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock(
  "next/navigation",
  () => ({
    redirect: vi.fn((url) => {
      throw new Error(`REDIRECT:${url}`);
    }),
  }),
);

import { redirect } from "next/navigation";
import PropertyPage from "./page";

describe(
  "/forge/property",
  () => {
    it(
      "redirects the retired route to the Rental Properties section, preserving the bookmark",
      () => {
        expect(() => PropertyPage()).toThrow("REDIRECT:/forge/rental?section=properties");
        expect(redirect).toHaveBeenCalledWith("/forge/rental?section=properties");
      },
    );
  },
);
