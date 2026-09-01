import { describe, expect, it } from "vitest";
import { resolveEffectiveOwnerId } from "./resolveEffectiveOwnerId";

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

describe("resolveEffectiveOwnerId", () => {
  it("returns the actor's own id when they have no active co_owner membership", async () => {
    const supabaseClient = stubSupabaseClient({ data: null });
    const result = await resolveEffectiveOwnerId({ supabaseClient, actorUserId: "actor-uuid-1" });
    expect(result).toBe("actor-uuid-1");
  });

  it("returns the workspace owner_id when the actor has an active co_owner membership", async () => {
    const supabaseClient = stubSupabaseClient({ data: { owner_id: "owner-uuid-primary" } });
    const result = await resolveEffectiveOwnerId({ supabaseClient, actorUserId: "actor-uuid-2" });
    expect(result).toBe("owner-uuid-primary");
  });

  it("filters on member_user_id, status=active, and role=co_owner -- matching the SQL helper's predicate exactly", async () => {
    let capturedFilters;
    const supabaseClient = stubSupabaseClient({
      data: null,
      captureFilters: (filters) => {
        capturedFilters = filters;
      },
    });
    await resolveEffectiveOwnerId({ supabaseClient, actorUserId: "actor-uuid-3" });
    expect(capturedFilters).toEqual([
      ["member_user_id", "actor-uuid-3"],
      ["status", "active"],
      ["role", "co_owner"],
    ]);
  });

  it("throws with a descriptive message when the query errors, rather than silently falling back", async () => {
    const supabaseClient = stubSupabaseClient({ data: null, error: { message: "connection refused" } });
    await expect(resolveEffectiveOwnerId({ supabaseClient, actorUserId: "actor-uuid-4" })).rejects.toThrow(/connection refused/);
  });
});
