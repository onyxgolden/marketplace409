import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({
  getActiveWorkspaceRole: vi.fn(async () => null),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { editContractorPayment } from "./maintenance.js";

const existing = {
  id: "cp_1", contractor_id: "contractor_1", paid_at: "2026-09-15",
};

function clientFor() {
  const calls = { updates: [], upserts: [] };
  const chain = {
    select() { return chain; },
    eq() { return chain; },
    async maybeSingle() { return { data: existing, error: null }; },
    update(patch) { calls.updates.push(patch); return chain; },
    async single() { return { data: { ...existing, ...calls.updates[0] }, error: null }; },
    upsert(row) { calls.upserts.push(row); return chain; },
    then(resolve) { resolve({ data: [], error: null }); },
  };
  return { client: { from: vi.fn(() => chain) }, calls };
}

const call = (client, payment) => editContractorPayment({
  authenticated: { supabaseClient: client, user: { id: "user_1" } },
  body: { payment },
  effectiveOwnerId: "owner_1",
});

describe("editContractorPayment", () => {
  it("edits amount, date, method, references, and notes", async () => {
    const { client, calls } = clientFor();
    const response = await call(client, {
      paymentId: "cp_1", amountCents: 85000, paidAt: "2026-09-16", paymentMethod: "check",
      reference: "CHK-9", invoiceReference: "INV-9", notes: "fixed",
    });
    expect(response.status).toBe(200);
    expect(calls.updates[0]).toMatchObject({
      amount_cents: 85000, paid_at: "2026-09-16", payment_method: "check",
      reference: "CHK-9", invoice_reference: "INV-9", notes: "fixed",
    });
    const body = await response.json();
    expect(body.success).toBe(true);
  });

  it("drops a 1099 review marker when the paid date moves years", async () => {
    const { client, calls } = clientFor();
    const response = await call(client, { paymentId: "cp_1", paidAt: "2027-01-05" });
    expect(response.status).toBe(200);
    expect(calls.upserts).toHaveLength(1);
    expect(calls.upserts[0]).toMatchObject({ contractor_id: "contractor_1", tax_year: 2027 });
  });

  it("skips the marker when the paid date does not change", async () => {
    const { client, calls } = clientFor();
    const response = await call(client, { paymentId: "cp_1", amountCents: 90000 });
    expect(response.status).toBe(200);
    expect(calls.upserts).toHaveLength(0);
  });

  it("refuses a non-positive amount and a bad date", async () => {
    const { client, calls } = clientFor();
    expect((await call(client, { paymentId: "cp_1", amountCents: 0 })).status).toBe(400);
    expect((await call(client, { paymentId: "cp_1", paidAt: "not-a-date" })).status).toBe(400);
    expect(calls.updates).toHaveLength(0);
  });
});
