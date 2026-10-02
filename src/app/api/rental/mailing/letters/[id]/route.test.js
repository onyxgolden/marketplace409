import { beforeEach, describe, expect, it, vi } from "vitest";

// The owner/co-owner gate (isOwnerOrActiveCoOwner) runs unmocked and reads the
// mocked workspace_members table: a mutable memberRole fixture drives it.
let memberRole = null;
const eventInserts = [];

vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { GET, PATCH } from "./route";

// The atomicity contract (ChatGPT GO WITH FIXES fix): the route performs the
// letter mutation and the compliance audit stamp in ONE rpc call to
// update_mailing_letter_atomic. It must never .update() rental_mail_letters
// or .insert() into rental_mail_letter_events directly — calls.update and
// eventInserts staying empty proves the single-write path.
function makeDb({ oneRow = null, updatedRow = null, rpcResult = null, rpcError = null } = {}) {
  const calls = { update: [], rpc: [] };
  const letterTable = {
    select() { return letterTable; },
    eq() { return letterTable; },
    order() { return letterTable; },
    update(payload) { calls.update.push(payload); return letterTable; },
    async maybeSingle() { return { data: oneRow, error: null }; },
    async single() { return { data: updatedRow ?? oneRow, error: null }; },
    then(resolve) { resolve({ data: [], error: null }); },
  };
  const memberTable = {
    select() { return memberTable; },
    eq() { return memberTable; },
    async maybeSingle() { return { data: memberRole ? { role: memberRole } : null, error: null }; },
  };
  const eventTable = {
    insert(rows) { eventInserts.push(...rows); return { then: (resolve) => resolve({ data: rows, error: null }) }; },
  };
  // Faithful stub of update_mailing_letter_atomic: applies the requested
  // mutation and derives mailed_at/delivered_at from the transition, exactly
  // like the SQL. The audit rows are created inside the RPC, invisible here.
  const rpc = async (fn, args) => {
    calls.rpc.push({ fn, args });
    if (rpcError) return { data: null, error: rpcError };
    if (rpcResult) return { data: rpcResult, error: null };
    const base = { ...(updatedRow ?? oneRow) };
    const nextStatus = args.p_next_status;
    if (nextStatus) {
      base.status = nextStatus;
      if (nextStatus === "mailed") base.mailed_at = "2026-10-02T12:00:00.000Z";
      if (nextStatus === "delivered") base.delivered_at = "2026-10-02T12:00:00.000Z";
      if (nextStatus === "queued") { base.mailed_at = null; base.delivered_at = null; }
      if (nextStatus === "mailed" && oneRow && oneRow.status === "delivered") base.delivered_at = null;
    }
    if (args.p_tracking_touched) base.tracking_number = args.p_next_tracking;
    return { data: base, error: null };
  };
  return {
    db: {
      from: vi.fn((table) => (table === "workspace_members" ? memberTable : table === "rental_mail_letter_events" ? eventTable : letterTable)),
      rpc,
    },
    calls,
  };
}

const LETTER = {
  id: "l1", batch_id: "b1", template_id: "tpl_mail", tenant_id: "t1",
  tenant_name: "Eric Carrillo", recipient_address: "308 Paula", return_address: null,
  subject: "Past-due rent", body: "Dear Eric Carrillo,",
  letter_date: "2026-10-01", status: "queued", tracking_number: null,
  mailed_at: null, delivered_at: null, document_id: null, created_at: "2026-10-01T00:00:00Z",
};
const TRACKING = "9407111111111111111111";

const get = () => GET(new Request("https://t/"), { params: { id: "l1" } });
const patch = (body) => PATCH(new Request("https://t/", { method: "PATCH", body: JSON.stringify(body) }), { params: { id: "l1" } });

beforeEach(() => {
  vi.clearAllMocks();
  memberRole = null; // primary owner: no membership row
  eventInserts.length = 0;
});

function authAs(db) {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user_1" }, effectiveOwnerId: "owner_1", supabaseClient: db,
  });
}

// Every successful mutation must go through exactly one RPC call with no
// direct table writes — the atomicity regression.
function expectAtomicWrite(calls) {
  expect(calls.rpc).toHaveLength(1);
  expect(calls.rpc[0].fn).toBe("update_mailing_letter_atomic");
  expect(calls.update).toHaveLength(0);
  expect(eventInserts).toHaveLength(0);
}

describe("mailing letter route", () => {
  it("returns the letter", async () => {
    const { db } = makeDb({ oneRow: LETTER });
    authAs(db);
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.letter).toMatchObject({ id: "l1", tenantName: "Eric Carrillo", status: "queued" });
  });

  it("404s an unknown letter", async () => {
    const { db, calls } = makeDb({ oneRow: null });
    authAs(db);
    expect((await get()).status).toBe(404);
    expect((await patch({ status: "mailed", trackingNumber: TRACKING })).status).toBe(404);
    expect(calls.rpc).toHaveLength(0);
  });

  describe("owner/co-owner authorization", () => {
    const staffRoles = ["manager", "bookkeeper", "read_only"];
    it.each(staffRoles)("blocks %s from updating a letter with 403", async (role) => {
      memberRole = role;
      const { db, calls } = makeDb({ oneRow: LETTER });
      authAs(db);
      const res = await patch({ trackingNumber: TRACKING });
      expect(res.status).toBe(403);
      expect((await res.json()).error).toContain("owner or co-owner");
      expect(calls.rpc).toHaveLength(0);
    });
    it("lets an active co_owner update a letter", async () => {
      memberRole = "co_owner";
      const { db, calls } = makeDb({ oneRow: LETTER });
      authAs(db);
      const res = await patch({ trackingNumber: TRACKING });
      expect(res.status).toBe(200);
      expectAtomicWrite(calls);
      expect(calls.rpc[0].args).toMatchObject({
        p_owner_id: "owner_1",
        p_letter_id: "l1",
        p_expected_status: "queued",
        p_expected_tracking: null,
        p_next_status: null,
        p_tracking_touched: true,
        p_next_tracking: TRACKING,
      });
    });
    it("lets the primary owner (no membership row) update a letter", async () => {
      memberRole = null;
      const { db, calls } = makeDb({ oneRow: LETTER });
      authAs(db);
      const res = await patch({ trackingNumber: TRACKING });
      expect(res.status).toBe(200);
      expectAtomicWrite(calls);
      expect(calls.rpc[0].args.p_next_tracking).toBe(TRACKING);
    });
  });

  it("moves queued → mailed with a tracking number and stamps mailed_at", async () => {
    const { db, calls } = makeDb({ oneRow: { ...LETTER, tracking_number: TRACKING } });
    authAs(db);
    const res = await patch({ status: "mailed" });
    expect(res.status).toBe(200);
    expectAtomicWrite(calls);
    expect(calls.rpc[0].args).toMatchObject({ p_next_status: "mailed", p_tracking_touched: false });
    const body = await res.json();
    expect(body.letter).toMatchObject({ status: "mailed" });
    expect(body.letter.mailedAt).toBeTruthy();
  });

  it("marks mailed and records the tracking number in one request", async () => {
    const { db, calls } = makeDb({ oneRow: LETTER });
    authAs(db);
    const res = await patch({ status: "mailed", trackingNumber: "9407 1111 1111 1111 1111 11" });
    expect(res.status).toBe(200);
    expectAtomicWrite(calls);
    expect(calls.rpc[0].args).toMatchObject({
      p_next_status: "mailed",
      p_tracking_touched: true,
      p_next_tracking: TRACKING,
    });
  });

  it("422s queued → mailed without a tracking number", async () => {
    const { db, calls } = makeDb({ oneRow: LETTER });
    authAs(db);
    const res = await patch({ status: "mailed" });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/tracking number/);
    expect(calls.update).toHaveLength(0);
    expect(calls.rpc).toHaveLength(0);
    expect(eventInserts).toHaveLength(0);
  });

  it("422s mailed → delivered when the tracking number is missing", async () => {
    const { db, calls } = makeDb({ oneRow: { ...LETTER, status: "mailed", tracking_number: null } });
    authAs(db);
    const res = await patch({ status: "delivered" });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/tracking number/);
    expect(calls.update).toHaveLength(0);
    expect(calls.rpc).toHaveLength(0);
  });

  it("rejects queued → delivered with 422", async () => {
    const { db, calls } = makeDb({ oneRow: LETTER });
    authAs(db);
    const res = await patch({ status: "delivered" });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/cannot move from "queued" to "delivered"/);
    expect(calls.update).toHaveLength(0);
    expect(calls.rpc).toHaveLength(0);
  });

  it("rejects delivered → queued with 422", async () => {
    const { db, calls } = makeDb({ oneRow: { ...LETTER, status: "delivered", tracking_number: TRACKING } });
    authAs(db);
    const res = await patch({ status: "queued" });
    expect(res.status).toBe(422);
    expect(calls.update).toHaveLength(0);
    expect(calls.rpc).toHaveLength(0);
  });

  it("allows mailed → delivered with tracking and stamps delivered_at", async () => {
    const { db, calls } = makeDb({ oneRow: { ...LETTER, status: "mailed", tracking_number: TRACKING } });
    authAs(db);
    const res = await patch({ status: "delivered" });
    expect(res.status).toBe(200);
    expectAtomicWrite(calls);
    expect(calls.rpc[0].args).toMatchObject({ p_next_status: "delivered" });
    const body = await res.json();
    expect(body.letter.deliveredAt).toBeTruthy();
  });

  it("reversing to queued clears both stamps", async () => {
    const { db, calls } = makeDb({ oneRow: { ...LETTER, status: "mailed", mailed_at: "2026-10-02T00:00:00Z", tracking_number: TRACKING } });
    authAs(db);
    const res = await patch({ status: "queued" });
    expect(res.status).toBe(200);
    expectAtomicWrite(calls);
    const body = await res.json();
    expect(body.letter).toMatchObject({ status: "queued", mailedAt: null, deliveredAt: null });
  });

  it("records a tracking number with normalization", async () => {
    const { db, calls } = makeDb({ oneRow: { ...LETTER, status: "mailed", tracking_number: TRACKING } });
    authAs(db);
    const res = await patch({ trackingNumber: "9407 1111 1111 1111 1111 11" });
    expect(res.status).toBe(200);
    expectAtomicWrite(calls);
    const body = await res.json();
    expect(body.letter.trackingNumber).toBe("9407111111111111111111");
  });

  it("400s an implausible tracking number", async () => {
    const { db, calls } = makeDb({ oneRow: { ...LETTER, status: "mailed", tracking_number: TRACKING } });
    authAs(db);
    const res = await patch({ trackingNumber: "abc" });
    expect(res.status).toBe(400);
    expect(calls.update).toHaveLength(0);
    expect(calls.rpc).toHaveLength(0);
  });

  it("422s clearing the tracking number on a mailed letter", async () => {
    const { db, calls } = makeDb({ oneRow: { ...LETTER, status: "mailed", tracking_number: TRACKING } });
    authAs(db);
    const res = await patch({ trackingNumber: "   " });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/tracking number/);
    expect(calls.update).toHaveLength(0);
    expect(calls.rpc).toHaveLength(0);
    expect(eventInserts).toHaveLength(0);
  });

  it("allows clearing the tracking number while still queued", async () => {
    const { db, calls } = makeDb({ oneRow: { ...LETTER, tracking_number: TRACKING } });
    authAs(db);
    const res = await patch({ trackingNumber: "   " });
    expect(res.status).toBe(200);
    expectAtomicWrite(calls);
    expect(calls.rpc[0].args).toMatchObject({ p_tracking_touched: true, p_next_tracking: null });
    const body = await res.json();
    expect(body.letter.trackingNumber).toBeNull();
  });

  it("422s changing the tracking number on a delivered letter", async () => {
    const { db, calls } = makeDb({ oneRow: { ...LETTER, status: "delivered", tracking_number: TRACKING } });
    authAs(db);
    const res = await patch({ trackingNumber: "9407222222222222222222" });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/reopen it as mailed/);
    expect(calls.update).toHaveLength(0);
    expect(calls.rpc).toHaveLength(0);
  });

  it("422s clearing the tracking number on a delivered letter", async () => {
    const { db, calls } = makeDb({ oneRow: { ...LETTER, status: "delivered", tracking_number: TRACKING } });
    authAs(db);
    const res = await patch({ trackingNumber: "" });
    expect(res.status).toBe(422);
    expect(calls.update).toHaveLength(0);
    expect(calls.rpc).toHaveLength(0);
  });

  it("allows correcting the tracking number after reopening delivered → mailed", async () => {
    const delivered = { ...LETTER, status: "delivered", tracking_number: TRACKING, delivered_at: "2026-10-03T00:00:00Z" };
    let current = delivered;
    const { db, calls } = makeDb({ oneRow: delivered });
    // Advance the fixture as the workflow proceeds.
    const letterTable = db.from("rental_mail_letters");
    letterTable.maybeSingle = async () => ({ data: current, error: null });
    authAs(db);
    const reopen = await patch({ status: "mailed" });
    expect(reopen.status).toBe(200);
    expect((await reopen.json()).letter.deliveredAt).toBeNull();
    current = { ...delivered, status: "mailed", delivered_at: null };
    const correct = await patch({ trackingNumber: "9407222222222222222222" });
    expect(correct.status).toBe(200);
    expect((await correct.json()).letter.trackingNumber).toBe("9407222222222222222222");
    expect(calls.rpc).toHaveLength(2);
    expect(calls.rpc[0].args).toMatchObject({ p_next_status: "mailed", p_expected_status: "delivered" });
    expect(calls.rpc[1].args).toMatchObject({ p_tracking_touched: true, p_next_tracking: "9407222222222222222222" });
    expect(calls.update).toHaveLength(0);
    expect(eventInserts).toHaveLength(0);
  });

  it("400s an unknown status value", async () => {
    const { db, calls } = makeDb({ oneRow: LETTER });
    authAs(db);
    expect((await patch({ status: "lost" })).status).toBe(400);
    expect(calls.rpc).toHaveLength(0);
  });

  describe("RPC failure mapping", () => {
    it("409s when the letter changed between read and write", async () => {
      const { db, calls } = makeDb({ oneRow: LETTER, rpcError: { code: "P0001", message: "Letter was changed or deleted." } });
      authAs(db);
      const res = await patch({ trackingNumber: TRACKING });
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/changed while you were editing/);
      expect(calls.rpc).toHaveLength(1);
    });
    it("403s when the RPC denies the write", async () => {
      const { db } = makeDb({ oneRow: LETTER, rpcError: { code: "42501", message: "Only the owner or co-owner can update mailings." } });
      authAs(db);
      const res = await patch({ trackingNumber: TRACKING });
      expect(res.status).toBe(403);
    });
    it("500s on an unexpected RPC failure", async () => {
      const { db } = makeDb({ oneRow: LETTER, rpcError: { code: "XX000", message: "boom" } });
      authAs(db);
      expect((await patch({ trackingNumber: TRACKING })).status).toBe(500);
    });
  });
});
