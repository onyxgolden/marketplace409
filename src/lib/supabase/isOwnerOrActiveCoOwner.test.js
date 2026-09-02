import { describe, expect, it } from "vitest";
import { isOwnerOrActiveCoOwner } from "./isOwnerOrActiveCoOwner";

function stubSupabaseClient({ data = null, error = null, captureFilters } = {}) {
  const filters = [];
  const builder = {
    select() {
      return builder;
    },
    eq(column, value) {
      filters.push([column, value]);
      return builder;
    },
    maybeSingle() {
      if (captureFilters) captureFilters(filters);
      return Promise.resolve({ data, error });
    },
  };
  return {
    from(table) {
      expect(table).toBe("workspace_members");
      return builder;
    },
  };
}

describe("isOwnerOrActiveCoOwner", () => {
  it("is true for a primary owner (no workspace_members row for their own workspace)", async () => {
    const supabaseClient = stubSupabaseClient({ data: null });
    await expect(isOwnerOrActiveCoOwner({ supabaseClient, actorUserId: "owner-uuid-1" })).resolves.toBe(true);
  });

  it("is true for an active co_owner", async () => {
    const supabaseClient = stubSupabaseClient({ data: { role: "co_owner" } });
    await expect(isOwnerOrActiveCoOwner({ supabaseClient, actorUserId: "coowner-uuid-1" })).resolves.toBe(true);
  });

  it("is false for staff roles -- manager, bookkeeper, and read_only", async () => {
    for (const role of ["manager", "bookkeeper", "read_only"]) {
      const supabaseClient = stubSupabaseClient({ data: { role } });
      await expect(isOwnerOrActiveCoOwner({ supabaseClient, actorUserId: "staff-uuid-1" })).resolves.toBe(false);
    }
  });

  it("filters on member_user_id and status=active, without a role filter (unlike resolveEffectiveOwnerId, every role must be inspected)", async () => {
    let capturedFilters;
    const supabaseClient = stubSupabaseClient({
      data: null,
      captureFilters: (filters) => {
        capturedFilters = filters;
      },
    });
    await isOwnerOrActiveCoOwner({ supabaseClient, actorUserId: "actor-uuid-1" });
    expect(capturedFilters).toEqual([
      ["member_user_id", "actor-uuid-1"],
      ["status", "active"],
    ]);
  });

  it("throws with a descriptive message when the query errors, rather than silently defaulting to visible", async () => {
    const supabaseClient = stubSupabaseClient({ data: null, error: { message: "connection refused" } });
    await expect(isOwnerOrActiveCoOwner({ supabaseClient, actorUserId: "actor-uuid-1" })).rejects.toThrow(/connection refused/);
  });
});
