import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./shared.js", () => ({
  badRequest: (message) => ({ status: 400, json: async () => ({ error: message }) }),
  readOnlyWriteBlocked: vi.fn().mockResolvedValue(false),
}));

import { readOnlyWriteBlocked } from "./shared.js";
import { retryRentNotification, resendRentNotification } from "./notifications.js";

// Controls-sweep follow-up G24 (O-16): retry failed, resend sent.
const AUTH = (client) => ({ user: { id: "user_1" }, supabaseClient: client });
const SENT_ORIGINAL = {
  tenant_id: "tenant_1", lease_id: "lease_1", notification_type: "rent_reminder",
  channel: "email", recipient: "t@example.com", subject: "Rent reminder",
  body_text: "Pay rent.", max_attempts: 3,
};

function makeClient({ retryRow = null, original = null } = {}) {
  const calls = [];
  const chain = (table) => {
    const c = {
      select() { return c; },
      eq() { return c; },
      update(payload) { calls.push({ table, op: "update", payload }); return c; },
      insert(payload) { calls.push({ table, op: "insert", payload }); return c; },
      async maybeSingle() {
        if (table === "rental_notification_outbox") {
          const updated = calls.some((x) => x.op === "update");
          return { data: updated ? retryRow : original, error: null };
        }
        return { data: null, error: null };
      },
      async single() { return { data: { id: "new_notif" }, error: null }; },
    };
    return c;
  };
  return { calls, from: (table) => chain(table) };
}

describe("G24 notification retry/resend", () => {
  beforeEach(() => { vi.clearAllMocks(); readOnlyWriteBlocked.mockResolvedValue(false); });

  it("O-16: retry requeues the same failed row with a fresh attempt budget", async () => {
    const client = makeClient({ retryRow: { id: "notif_f", status: "queued" } });
    const res = await retryRentNotification({ authenticated: AUTH(client), effectiveOwnerId: "owner_1", body: { notificationId: "notif_f" } });
    expect(res.status).toBe(200);
    const update = client.calls.find((c) => c.op === "update");
    expect(update.payload).toMatchObject({ status: "queued", attempt_count: 0, failure_message: null, sent_at: null, provider_message_id: null });
  });

  it("O-16: retry 404s when no failed row matches", async () => {
    const client = makeClient({ retryRow: null });
    const res = await retryRentNotification({ authenticated: AUTH(client), effectiveOwnerId: "owner_1", body: { notificationId: "notif_x" } });
    expect(res.status).toBe(404);
  });

  it("O-16: resend copies a sent notice into a new queued row", async () => {
    const client = makeClient({ original: SENT_ORIGINAL });
    const res = await resendRentNotification({ authenticated: AUTH(client), effectiveOwnerId: "owner_1", body: { notificationId: "notif_s" } });
    expect(res.status).toBe(200);
    const insert = client.calls.find((c) => c.op === "insert");
    expect(insert.payload).toMatchObject({
      tenant_id: "tenant_1", lease_id: "lease_1", subject: "Rent reminder",
      recipient: "t@example.com", body_text: "Pay rent.", max_attempts: 3,
    });
    expect(insert.payload.event_key.startsWith("resend:notif_s:")).toBe(true);
    expect(insert.payload.id).not.toBe("notif_s");
  });

  it("O-16: resend 404s when no sent row matches, and read-only members get 403", async () => {
    const client = makeClient({ original: null });
    const res = await resendRentNotification({ authenticated: AUTH(client), effectiveOwnerId: "owner_1", body: { notificationId: "notif_x" } });
    expect(res.status).toBe(404);
    readOnlyWriteBlocked.mockResolvedValue(true);
    const res2 = await retryRentNotification({ authenticated: AUTH(client), effectiveOwnerId: "owner_1", body: { notificationId: "notif_f" } });
    expect(res2.status).toBe(403);
    const res3 = await resendRentNotification({ authenticated: AUTH(client), effectiveOwnerId: "owner_1", body: { notificationId: "notif_s" } });
    expect(res3.status).toBe(403);
  });
});
