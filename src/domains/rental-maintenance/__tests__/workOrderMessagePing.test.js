import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
vi.mock("@/infrastructure/notifications/ResendRentalEmailProvider", () => ({
  createResendRentalEmailProvider: vi.fn(() => ({ send })),
}));

import {
  buildWorkOrderMessageEventKey,
  buildWorkOrderMessagePing,
  queueWorkOrderMessagePing,
} from "../workOrderMessagePing.js";

// Minimal scripted Supabase query-builder fake: insert/update/select chains resolve scripted
// {data, error} pairs in call order, and every call is recorded for assertions.
function makeDb(script) {
  const calls = [];
  const api = {
    from(table) {
      const state = { table, filters: [], op: null, payload: null };
      const chain = {
        select(cols) { if (!state.op) state.op = "select"; state.cols = cols; return chain; },
        insert(rows) { state.op = "insert"; state.payload = rows; return chain; },
        update(patch) { state.op = "update"; state.payload = patch; return chain; },
        eq(col, val) { state.filters.push([col, val]); return chain; },
        maybeSingle() {
          if (state.op !== "select") return Promise.reject(new Error(`maybeSingle on ${state.op}`));
          calls.push({ op: "select", table, filters: state.filters });
          const next = script.select.shift();
          if (!next) return Promise.reject(new Error("no scripted select response"));
          return Promise.resolve(next);
        },
        then(resolve, reject) {
          if (state.op !== "insert" && state.op !== "update") {
            if (reject) reject(new Error(`unexpected terminal ${state.op}`));
            return undefined;
          }
          calls.push({ op: state.op, table, payload: state.payload, filters: state.filters });
          const next = script[state.op].shift();
          if (!next) { if (reject) reject(new Error(`no scripted ${state.op} response`)); return undefined; }
          Promise.resolve(next).then(resolve, reject);
          return undefined;
        },
      };
      return chain;
    },
  };
  return { db: api, calls };
}

const baseArgs = { ownerId: "owner_1", tenantId: "tenant_1", leaseId: "lease_1",
  eventKey: "work-order-message:m1", recipient: "brandy@example.com",
  subject: "Ping subject", bodyText: "Ping body" };

describe("work-order message ping", () => {
  beforeEach(() => vi.clearAllMocks());

  it("builds a per-message unique event key", () => {
    expect(buildWorkOrderMessageEventKey({ messageId: "m1" })).toBe("work-order-message:m1");
    expect(buildWorkOrderMessageEventKey({ messageId: "m2" })).not.toBe(buildWorkOrderMessageEventKey({ messageId: "m1" }));
  });

  it("addresses the ping to the other party with plain-English copy", () => {
    const toTenant = buildWorkOrderMessagePing({ direction: "owner_to_tenant", tenantName: "Brandy", workOrderScope: "Sink leak" });
    expect(toTenant.subject).toContain("maintenance");
    expect(toTenant.bodyText).not.toContain("Brandy");
    const toOwner = buildWorkOrderMessagePing({ direction: "tenant_to_owner", tenantName: "Eric", workOrderScope: "Sink leak" });
    expect(toOwner.subject).toContain("tenant");
    expect(toOwner.bodyText).toContain("Eric");
  });

  it("sends immediately after a fresh insert and marks the row sent", async () => {
    send.mockResolvedValue({ messageId: "resend_1" });
    const { db, calls } = makeDb({
      insert: [{ data: [{ id: "n_1" }], error: null }],
      select: [],
      update: [
        { data: [{ id: "n_1" }], error: null }, // claim to sending
        { data: [{ id: "n_1" }], error: null }, // mark sent
      ],
    });
    const result = await queueWorkOrderMessagePing({ supabaseClient: db, ...baseArgs });
    expect(result).toEqual({ notificationId: "n_1", recipient: "brandy@example.com" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      id: "work-order-message:m1", recipient: "brandy@example.com", subject: "Ping subject",
    }));
    const insertCall = calls.find((call) => call.op === "insert");
    expect(insertCall.payload.notification_type).toBe("work_order_message");
    expect(insertCall.payload.event_key).toBe("work-order-message:m1");
    const sentCall = calls.filter((call) => call.op === "update").pop();
    expect(sentCall.payload.status).toBe("sent");
    expect(sentCall.payload.provider_message_id).toBe("resend_1");
  });

  it("treats a duplicate insert for an already-queued ping as already sent", async () => {
    const { db } = makeDb({
      insert: [{ data: null, error: { code: "23505" } }],
      select: [{ data: { id: "n_old", status: "queued", attempt_count: 0, max_attempts: 3 }, error: null }],
      update: [],
    });
    const result = await queueWorkOrderMessagePing({ supabaseClient: db, ...baseArgs });
    expect(result).toEqual({ notificationId: "n_old", recipient: "brandy@example.com", alreadySent: true });
    expect(send).not.toHaveBeenCalled();
  });

  it("treats losing the claim race as already sent", async () => {
    const { db } = makeDb({
      insert: [{ data: [{ id: "n_1" }], error: null }],
      select: [],
      update: [{ data: [], error: null }], // another worker claimed the row
    });
    const result = await queueWorkOrderMessagePing({ supabaseClient: db, ...baseArgs });
    expect(result.alreadySent).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it("marks the row failed and queues it for retry when the send throws", async () => {
    send.mockRejectedValue(new Error("provider down"));
    const { db, calls } = makeDb({
      insert: [{ data: [{ id: "n_1" }], error: null }],
      select: [],
      update: [
        { data: [{ id: "n_1" }], error: null },
        { data: [{ id: "n_1" }], error: null },
      ],
    });
    const result = await queueWorkOrderMessagePing({ supabaseClient: db, ...baseArgs });
    expect(result.notificationId).toBe("n_1");
    expect(result.deliveryError).toContain("queued for retry");
    const failedCall = calls.filter((call) => call.op === "update").pop();
    expect(failedCall.payload.status).toBe("failed");
  });

  it("reclaims a failed row under its attempt budget and retries the send", async () => {
    send.mockResolvedValue({ messageId: "resend_2" });
    const { db } = makeDb({
      insert: [{ data: null, error: { code: "23505" } }],
      select: [{ data: { id: "n_old", status: "failed", attempt_count: 1, max_attempts: 3 }, error: null }],
      update: [
        { data: [{ id: "n_old" }], error: null }, // reclaim to queued
        { data: [{ id: "n_old" }], error: null }, // claim to sending
        { data: [{ id: "n_old" }], error: null }, // mark sent
      ],
    });
    const result = await queueWorkOrderMessagePing({ supabaseClient: db, ...baseArgs });
    expect(result.notificationId).toBe("n_old");
    expect(result.alreadySent).toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
