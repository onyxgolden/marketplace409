import { describe, expect, it } from "vitest";
import { isRegisterHouseholdActor } from "../externalAccountHouseholdGate";

// Mocked Supabase client. The shared helper queries
//   workspace_members.select("role").eq(member).eq(status, active).maybeSingle()
// and the wrapper queries
//   workspace_members.select("status").eq(member).eq(status, suspended)
// (awaited directly). The mock answers each from the supplied rows.
function mockClient({ rows = [], suspendedError = null } = {}) {
  const chainFor = (columns) => {
    const chain = {
      eq: () => chain,
      maybeSingle: async () => {
        const active = rows.find((row) => row.status === "active") ?? null;
        return { data: active, error: null };
      },
      then: (resolve) => {
        if (columns === "status") {
          resolve({
            data: suspendedError
              ? null
              : rows.filter((row) => row.status === "suspended"),
            error: suspendedError,
          });
        } else {
          resolve({ data: null, error: null });
        }
        return undefined;
      },
    };
    return chain;
  };
  return {
    from: () => ({
      select: (columns) => chainFor(columns),
    }),
  };
}

const OWNER_A = "11111111-1111-1111-1111-111111111111";
const BRANDY = "22222222-2222-2222-2222-222222222222";
const MEMBER_C = "33333333-3333-3333-3333-333333333333";
const REVOKED_D = "55555555-5555-5555-5555-555555555555";

describe("isRegisterHouseholdActor", () => {
  it("admits the primary owner (no membership rows at all)", async () => {
    const client = mockClient({ rows: [] });
    expect(await isRegisterHouseholdActor({ supabaseClient: client, actorUserId: OWNER_A })).toBe(
      true,
    );
  });

  it("admits an active co-owner with no suspended rows", async () => {
    const client = mockClient({
      rows: [{ role: "co_owner", status: "active" }],
    });
    expect(await isRegisterHouseholdActor({ supabaseClient: client, actorUserId: BRANDY })).toBe(
      true,
    );
  });

  it("denies an active staff member (manager)", async () => {
    const client = mockClient({
      rows: [{ role: "manager", status: "active" }],
    });
    expect(await isRegisterHouseholdActor({ supabaseClient: client, actorUserId: MEMBER_C })).toBe(
      false,
    );
  });

  it("denies a revoked co-owner — the shared helper alone would admit them", async () => {
    // No ACTIVE row, so isOwnerOrActiveCoOwner returns true; the
    // suspended row is what this wrapper adds.
    const client = mockClient({
      rows: [{ role: "co_owner", status: "suspended" }],
    });
    expect(
      await isRegisterHouseholdActor({ supabaseClient: client, actorUserId: REVOKED_D }),
    ).toBe(false);
  });

  it("denies an active co-owner who also holds a suspended row elsewhere", async () => {
    const client = mockClient({
      rows: [
        { role: "co_owner", status: "active" },
        { role: "co_owner", status: "suspended" },
      ],
    });
    expect(await isRegisterHouseholdActor({ supabaseClient: client, actorUserId: BRANDY })).toBe(
      false,
    );
  });

  it("denies anon (no actor)", async () => {
    const client = mockClient({ rows: [] });
    expect(
      await isRegisterHouseholdActor({ supabaseClient: client, actorUserId: null }),
    ).toBe(false);
  });

  it("throws (never admits) when the membership lookup fails", async () => {
    const client = mockClient({
      rows: [],
      suspendedError: new Error("boom"),
    });
    await expect(
      isRegisterHouseholdActor({ supabaseClient: client, actorUserId: OWNER_A }),
    ).rejects.toThrow("Failed to resolve workspace membership");
  });
});
