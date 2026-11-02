import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({
  getActiveWorkspaceRole: vi.fn(async () => null),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { editTenantCredit } from "./payments.js";

const openCredit = {
  id: "credit_1", amount_cents: 100000, remaining_cents: 60000, status: "open", notes: "old note",
};

function clientFor(credit) {
  const calls = { updates: [] };
  const chain = {
    select() { return chain; },
    eq() { return chain; },
    async maybeSingle() { return { data: credit, error: null }; },
    update(patch) { calls.updates.push(patch); return chain; },
    async single() { return { data: { ...credit, ...calls.updates[0] }, error: null }; },
  };
  return { client: { from: vi.fn(() => chain) }, calls };
}

const call = (client, credit) => editTenantCredit({
  authenticated: { supabaseClient: client, user: { id: "user_1" } },
  body: { credit },
  effectiveOwnerId: "owner_1",
});

describe("editTenantCredit", () => {
  it("edits the amount and recomputes the remainder from what is already applied", async () => {
    const { client, calls } = clientFor(openCredit);
    const response = await call(client, { creditId: "credit_1", amountCents: 150000, notes: "fixed", ownerConfirmed: true });
    expect(response.status).toBe(200);
    // Applied is 40,000 (100,000 − 60,000) — the new remainder is 110,000.
    expect(calls.updates[0]).toMatchObject({ amount_cents: 150000, remaining_cents: 110000, notes: "fixed" });
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.credit.remaining_cents).toBe(110000);
  });

  it("refuses an amount below what is already applied", async () => {
    const { client, calls } = clientFor(openCredit);
    const response = await call(client, { creditId: "credit_1", amountCents: 30000, ownerConfirmed: true });
    expect(response.status).toBe(409);
    expect(calls.updates).toHaveLength(0);
  });

  it("refuses credits that are not open", async () => {
    const { client } = clientFor({ ...openCredit, status: "void" });
    const response = await call(client, { creditId: "credit_1", amountCents: 150000, ownerConfirmed: true });
    expect(response.status).toBe(409);
  });

  it("edits notes alone without touching the amount or remainder", async () => {
    const { client, calls } = clientFor(openCredit);
    const response = await call(client, { creditId: "credit_1", notes: "new note", ownerConfirmed: true });
    expect(response.status).toBe(200);
    expect(calls.updates[0]).toMatchObject({ notes: "new note" });
    expect(calls.updates[0].amount_cents).toBeUndefined();
    expect(calls.updates[0].remaining_cents).toBeUndefined();
  });

  it("requires owner confirmation", async () => {
    const { client, calls } = clientFor(openCredit);
    const response = await call(client, { creditId: "credit_1", amountCents: 150000 });
    expect(response.status).toBe(400);
    expect(calls.updates).toHaveLength(0);
  });
});
