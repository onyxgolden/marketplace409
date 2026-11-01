import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { saveTenant } from "./_actions/tenants.js";

const saved = [];
function chainable() {
  const chain = {
    select: () => chain,
    eq: () => chain,
    then: (resolve) => resolve({ data: [], error: null }),
  };
  return chain;
}
const application = { saveTenant: vi.fn(async (tenant) => { saved.push(tenant); return tenant; }) };
const authenticated = { supabaseClient: { from: () => chainable() } };

function callSave(tenant) {
  return saveTenant({
    authenticated,
    body: { tenant },
    application,
    effectiveOwnerId: "owner_1",
    timestamp: "2026-11-01T12:00:00.000Z",
  });
}

describe("save-tenant invite honesty", () => {
  beforeEach(() => { saved.length = 0; vi.clearAllMocks(); });

  it("creates a tenant as inactive with no invited_at — creation is not an invite", async () => {
    const response = await callSave({ displayName: "Next Renter", email: "next@example.com", phone: null });
    expect(response.status).toBe(200);
    expect(saved).toHaveLength(1);
    expect(saved[0].status).toBe("inactive");
    expect(saved[0].invitedAt).toBeNull();
  });

  it("does not stamp invited_at even when the caller omits it", async () => {
    const response = await callSave({ displayName: "Next Renter", email: "next@example.com" });
    const body = await response.json();
    expect(body.tenant.invitedAt).toBeNull();
    expect(body.tenant.status).toBe("inactive");
  });
});
