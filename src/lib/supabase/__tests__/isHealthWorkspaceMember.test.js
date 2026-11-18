import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { isHealthWorkspaceMember } from "../isHealthWorkspaceMember.js";

function makeClient({ data, error }) {
  const maybeSingle = vi.fn().mockResolvedValue({ data, error });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { from, maybeSingle, eq, select };
}

describe("isHealthWorkspaceMember", () => {
  it("returns true when the user has a health workspace membership row", async () => {
    const supabaseClient = makeClient({
      data: { workspace_id: "023cc443-2b10-48fd-8aa9-863a9181d328", role: "owner" },
      error: null,
    });

    expect(
      await isHealthWorkspaceMember({
        supabaseClient,
        actorUserId: "e1b22131-9100-4a79-bbe2-b82d43af922e",
      }),
    ).toBe(true);
    expect(supabaseClient.from).toHaveBeenCalledWith(
      "health_workspace_members",
    );
    expect(supabaseClient.eq).toHaveBeenCalledWith(
      "user_id",
      "e1b22131-9100-4a79-bbe2-b82d43af922e",
    );
  });

  it("returns false when the user has no membership row", async () => {
    const supabaseClient = makeClient({ data: null, error: null });

    expect(
      await isHealthWorkspaceMember({
        supabaseClient,
        actorUserId: "someone-else",
      }),
    ).toBe(false);
  });

  it("fails closed (false) when the membership query errors", async () => {
    const supabaseClient = makeClient({
      data: null,
      error: { message: "boom" },
    });

    expect(
      await isHealthWorkspaceMember({
        supabaseClient,
        actorUserId: "e1b22131-9100-4a79-bbe2-b82d43af922e",
      }),
    ).toBe(false);
  });
});
