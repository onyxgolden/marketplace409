import { describe, expect, it } from "vitest";
import { listWorkspacesForActor, resolveEffectiveOwnerId } from "./resolveEffectiveOwnerId";

function stubSupabaseClient({ data = [], error = null, captureFilters } = {}) {
  const filters = [];
  const builder = {
    select() {
      return builder;
    },
    eq(column, value) {
      filters.push([column, value]);
      return builder;
    },
    // Supabase query builders are thenable; awaiting one resolves { data, error }.
    then(resolve) {
      if (captureFilters) captureFilters(filters);
      return Promise.resolve({ data, error }).then(resolve);
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
  it("returns the actor's own id when they have no active membership", async () => {
    const supabaseClient = stubSupabaseClient({ data: [] });
    const result = await resolveEffectiveOwnerId({ supabaseClient, actorUserId: "actor-uuid-1" });
    expect(result).toBe("actor-uuid-1");
  });

  it("returns the workspace owner_id when the actor has an active staff membership (any role)", async () => {
    const supabaseClient = stubSupabaseClient({ data: [{ owner_id: "owner-uuid-primary", role: "co_owner" }] });
    const result = await resolveEffectiveOwnerId({ supabaseClient, actorUserId: "actor-uuid-2" });
    expect(result).toBe("owner-uuid-primary");
  });

  it("filters on member_user_id and status=active only -- matching the SQL helper's predicate exactly (R17: staff roles resolve too)", async () => {
    let capturedFilters;
    const supabaseClient = stubSupabaseClient({
      data: [],
      captureFilters: (filters) => {
        capturedFilters = filters;
      },
    });
    await resolveEffectiveOwnerId({ supabaseClient, actorUserId: "actor-uuid-3" });
    expect(capturedFilters).toEqual([
      ["member_user_id", "actor-uuid-3"],
      ["status", "active"],
    ]);
  });

  it("throws with a descriptive message when the query errors, rather than silently falling back", async () => {
    const supabaseClient = stubSupabaseClient({ data: [], error: { message: "connection refused" } });
    await expect(resolveEffectiveOwnerId({ supabaseClient, actorUserId: "actor-uuid-4" })).rejects.toThrow(/connection refused/);
  });

  it("honors a requested owner that is the actor's own id", async () => {
    const supabaseClient = stubSupabaseClient({ data: [{ owner_id: "owner-uuid-primary", role: "co_owner" }] });
    const result = await resolveEffectiveOwnerId({ supabaseClient, actorUserId: "actor-uuid-5", requestedOwnerId: "actor-uuid-5" });
    expect(result).toBe("actor-uuid-5");
  });

  it("honors a requested owner that is an active membership", async () => {
    const supabaseClient = stubSupabaseClient({ data: [{ owner_id: "owner-uuid-primary", role: "co_owner" }] });
    const result = await resolveEffectiveOwnerId({ supabaseClient, actorUserId: "actor-uuid-6", requestedOwnerId: "owner-uuid-primary" });
    expect(result).toBe("owner-uuid-primary");
  });

  it("falls back to the default when the requested owner is not the actor's own id or an active membership", async () => {
    const supabaseClient = stubSupabaseClient({ data: [{ owner_id: "owner-uuid-primary", role: "co_owner" }] });
    const result = await resolveEffectiveOwnerId({ supabaseClient, actorUserId: "actor-uuid-7", requestedOwnerId: "owner-uuid-stranger" });
    expect(result).toBe("owner-uuid-primary");
  });

  it("falls back to the actor's own id when the requested owner is foreign and there is no membership", async () => {
    const supabaseClient = stubSupabaseClient({ data: [] });
    const result = await resolveEffectiveOwnerId({ supabaseClient, actorUserId: "actor-uuid-8", requestedOwnerId: "owner-uuid-stranger" });
    expect(result).toBe("actor-uuid-8");
  });

  it("ignores an empty requested owner", async () => {
    const supabaseClient = stubSupabaseClient({ data: [{ owner_id: "owner-uuid-primary", role: "co_owner" }] });
    const result = await resolveEffectiveOwnerId({ supabaseClient, actorUserId: "actor-uuid-9", requestedOwnerId: "" });
    expect(result).toBe("owner-uuid-primary");
  });
});

describe("listWorkspacesForActor", () => {
  it("lists only the actor's own workspace when there are no memberships", async () => {
    const supabaseClient = stubSupabaseClient({ data: [] });
    const result = await listWorkspacesForActor({ supabaseClient, actorUserId: "actor-uuid-1" });
    expect(result).toEqual([{ ownerId: "actor-uuid-1", role: "owner", label: "My workspace" }]);
  });

  it("lists the actor's own workspace first, then each active membership as a shared workspace", async () => {
    const supabaseClient = stubSupabaseClient({ data: [{ owner_id: "owner-uuid-primary", role: "co_owner" }] });
    const result = await listWorkspacesForActor({ supabaseClient, actorUserId: "actor-uuid-2" });
    expect(result).toEqual([
      { ownerId: "actor-uuid-2", role: "owner", label: "My workspace" },
      { ownerId: "owner-uuid-primary", role: "co_owner", label: "Shared workspace" },
    ]);
  });

  it("degrades to own-only when the membership read fails", async () => {
    const supabaseClient = stubSupabaseClient({ data: [], error: { message: "connection refused" } });
    const result = await listWorkspacesForActor({ supabaseClient, actorUserId: "actor-uuid-3" });
    expect(result).toEqual([{ ownerId: "actor-uuid-3", role: "owner", label: "My workspace" }]);
  });
});
