import { describe, expect, it, vi } from "vitest";
import { getActiveWorkspaceRole } from "./getActiveWorkspaceRole.js";

function clientReturning(role, error = null) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({ data: role ? { role } : null, error })),
  };
  return { from: vi.fn(() => query), __query: query };
}

describe("getActiveWorkspaceRole", () => {
  it("returns the actor's active workspace role", async () => {
    const client = clientReturning("read_only");
    const role = await getActiveWorkspaceRole({ supabaseClient: client, actorUserId: "staff_1" });
    expect(role).toBe("read_only");
    expect(client.from).toHaveBeenCalledWith("workspace_members");
    expect(client.__query.eq).toHaveBeenCalledWith("member_user_id", "staff_1");
    expect(client.__query.eq).toHaveBeenCalledWith("status", "active");
  });

  it("returns null when the actor has no active membership row", async () => {
    const client = clientReturning(null);
    expect(await getActiveWorkspaceRole({ supabaseClient: client, actorUserId: "owner_1" })).toBeNull();
  });

  it("throws a descriptive error when the role lookup fails", async () => {
    const client = clientReturning(null, { message: "boom" });
    await expect(getActiveWorkspaceRole({ supabaseClient: client, actorUserId: "staff_1" }))
      .rejects.toThrow("Failed to resolve workspace role");
  });
});
