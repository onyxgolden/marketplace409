import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateClient = vi.fn();
const mockCreateServiceClient = vi.fn();
const mockSend = vi.fn();

vi.mock("@/lib/supabase/server", () => ({ createClient: (...args) => mockCreateClient(...args) }));
vi.mock("@/lib/supabase/createLoginSafetyServiceClient", () => ({
  createLoginSafetyServiceClient: (...args) => mockCreateServiceClient(...args),
}));
vi.mock("@/infrastructure/notifications/ResendRentalEmailProvider", () => ({
  createResendRentalEmailProvider: () => ({ send: mockSend }),
}));

const { POST } = await import("./route.js");

const SESSION_USER = { id: "user-real-1111", email: "owner@example.com" };

function fakeSessionDb({ recordEventResult, locationResult, settingsSelectResult, settingsInsertResult }) {
  const calls = [];
  const record = (entry) => calls.push(entry);
  return {
    calls,
    auth: { getUser: async () => ({ data: { user: SESSION_USER }, error: null }) },
    rpc: async (name, args) => {
      record({ kind: "rpc", name, args });
      if (name === "record_login_event") return recordEventResult;
      if (name === "upsert_known_login_location") return locationResult;
      throw new Error(`unexpected rpc ${name}`);
    },
    from: (table) => ({
      select: () => ({
        eq: (col, val) => {
          record({ kind: "from", table, op: "select", col, val });
          return { maybeSingle: async () => settingsSelectResult };
        },
      }),
      insert: (row) => {
        record({ kind: "from", table, op: "insert", row });
        return { select: () => ({ single: async () => settingsInsertResult }) };
      },
    }),
  };
}

function fakeServiceDb({ tokenInsertResult }) {
  const calls = [];
  return {
    calls,
    from: (table) => ({
      insert: (rows) => {
        calls.push({ kind: "insert", table, rows });
        return { select: () => Promise.resolve(tokenInsertResult) };
      },
    }),
  };
}

const happyRecordEvent = { data: [{ login_id: "login-1", was_duplicate: false }], error: null };
const newLocation = { data: [{ location_id: "loc-1", is_new: true }], error: null };
const knownLocation = { data: [{ location_id: "loc-1", is_new: false }], error: null };
const noSettings = { data: null, error: null };
const defaultSettings = { data: { alert_on_new_location: true }, error: null };
const tokenInsertOk = { data: [{ id: "tok-1" }, { id: "tok-2" }], error: null };

function postRequest(body, headers = {}) {
  return new Request("https://example.test/api/auth/record-login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.7, 10.0.0.1",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0",
      "x-vercel-ip-country": "US",
      "x-vercel-ip-city": "Austin",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SECURITY_EMAIL_FROM = "security@409marketplace.online";
  process.env.NEXT_PUBLIC_SITE_URL = "https://409marketplace.online";
  mockSend.mockResolvedValue({ messageId: "resend-1" });
});

describe("POST /api/auth/record-login", () => {
  it("returns 401 when there is no session", async () => {
    mockCreateClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null }, error: new Error("nope") }) } });
    const res = await POST(postRequest({ session_id: "s1" }));
    expect(res.status).toBe(401);
  });

  it("ignores a user_id supplied in the request body", async () => {
    const db = fakeSessionDb({
      recordEventResult: happyRecordEvent,
      locationResult: newLocation,
      settingsSelectResult: noSettings,
      settingsInsertResult: defaultSettings,
    });
    mockCreateClient.mockResolvedValue(db);
    mockCreateServiceClient.mockReturnValue(fakeServiceDb({ tokenInsertResult: tokenInsertOk }));

    const res = await POST(postRequest({ user_id: "attacker-id-9999", session_id: "s1" }));
    expect(res.status).toBe(200);

    const serialized = JSON.stringify(db.calls);
    expect(serialized).not.toContain("attacker-id-9999");
    const serviceCalls = mockCreateServiceClient.mock.results[0].value.calls;
    expect(JSON.stringify(serviceCalls)).not.toContain("attacker-id-9999");
    // Every user-bound write targets the session user.
    expect(JSON.stringify(serviceCalls)).toContain(SESSION_USER.id);
  });

  it("returns deduped:true and stops on a repeated event", async () => {
    const db = fakeSessionDb({
      recordEventResult: { data: [{ login_id: "login-1", was_duplicate: true }], error: null },
      locationResult: newLocation,
      settingsSelectResult: noSettings,
      settingsInsertResult: defaultSettings,
    });
    mockCreateClient.mockResolvedValue(db);

    const res = await POST(postRequest({ session_id: "s1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, deduped: true });
    expect(db.calls.some((c) => c.name === "upsert_known_login_location")).toBe(false);
    expect(mockCreateServiceClient).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("captures the client IP server-side from x-forwarded-for (first entry)", async () => {
    const db = fakeSessionDb({
      recordEventResult: happyRecordEvent,
      locationResult: knownLocation,
      settingsSelectResult: defaultSettings,
      settingsInsertResult: defaultSettings,
    });
    mockCreateClient.mockResolvedValue(db);

    await POST(postRequest({ session_id: "s1" }));
    const recordCall = db.calls.find((c) => c.name === "record_login_event");
    expect(recordCall.args.p_ip_address).toBe("203.0.113.7");
    expect(recordCall.args.p_country).toBe("US");
    expect(recordCall.args.p_city).toBe("Austin");
    expect(recordCall.args.p_result).toBe("success");
  });

  it("mints hashed-only tokens and emails approve/deny links for a new location", async () => {
    const db = fakeSessionDb({
      recordEventResult: happyRecordEvent,
      locationResult: newLocation,
      settingsSelectResult: noSettings,
      settingsInsertResult: defaultSettings,
    });
    mockCreateClient.mockResolvedValue(db);
    const service = fakeServiceDb({ tokenInsertResult: tokenInsertOk });
    mockCreateServiceClient.mockReturnValue(service);

    const res = await POST(postRequest({ session_id: "s1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, alerted: true });

    // Tokens: hashes stored, raw tokens never persisted.
    const tokenInsert = service.calls.find((c) => c.table === "location_action_tokens");
    expect(tokenInsert.rows).toHaveLength(2);
    expect(new Set(tokenInsert.rows.map((r) => r.action))).toEqual(new Set(["approve", "deny"]));
    for (const row of tokenInsert.rows) {
      expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(row).not.toHaveProperty("token");
      expect(row.user_id).toBe(SESSION_USER.id);
      expect(row.login_history_id).toBe("login-1");
    }
    expect(tokenInsert.rows[0].token_hash).not.toBe(tokenInsert.rows[1].token_hash);

    // Email: one message, approve+deny links, recipient from the session.
    expect(mockSend).toHaveBeenCalledTimes(1);
    const message = mockSend.mock.calls[0][0];
    expect(message.recipient).toBe("owner@example.com");
    expect(message.senderEmail).toBe("security@409marketplace.online");
    expect(message.bodyText).toContain("action=approve");
    expect(message.bodyText).toContain("action=deny");
    // One-tap links must hit the real API endpoint, not a UI page.
    expect(message.bodyText).toContain("https://409marketplace.online/api/auth/verify-location?token=");
    expect(message.bodyText).not.toContain("online/auth/verify-location?token=");
    expect(message.bodyText).toContain("Austin, US");
  });

  it("skips the alert when the account opted out", async () => {
    const db = fakeSessionDb({
      recordEventResult: happyRecordEvent,
      locationResult: newLocation,
      settingsSelectResult: { data: { alert_on_new_location: false }, error: null },
      settingsInsertResult: defaultSettings,
    });
    mockCreateClient.mockResolvedValue(db);

    const res = await POST(postRequest({ session_id: "s1" }));
    expect(await res.json()).toEqual({ success: true, alerted: false });
    expect(mockCreateServiceClient).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("skips the alert for a known location", async () => {
    const db = fakeSessionDb({
      recordEventResult: happyRecordEvent,
      locationResult: knownLocation,
      settingsSelectResult: defaultSettings,
      settingsInsertResult: defaultSettings,
    });
    mockCreateClient.mockResolvedValue(db);

    const res = await POST(postRequest({ session_id: "s1" }));
    expect(await res.json()).toEqual({ success: true, alerted: false });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("still succeeds when the alert email fails to send", async () => {
    const db = fakeSessionDb({
      recordEventResult: happyRecordEvent,
      locationResult: newLocation,
      settingsSelectResult: noSettings,
      settingsInsertResult: defaultSettings,
    });
    mockCreateClient.mockResolvedValue(db);
    mockCreateServiceClient.mockReturnValue(fakeServiceDb({ tokenInsertResult: tokenInsertOk }));
    mockSend.mockRejectedValue(new Error("Resend down"));

    const res = await POST(postRequest({ session_id: "s1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, alerted: true });
  });

  it("skips token minting when SECURITY_EMAIL_FROM is not configured", async () => {
    delete process.env.SECURITY_EMAIL_FROM;
    const db = fakeSessionDb({
      recordEventResult: happyRecordEvent,
      locationResult: newLocation,
      settingsSelectResult: noSettings,
      settingsInsertResult: defaultSettings,
    });
    mockCreateClient.mockResolvedValue(db);

    const res = await POST(postRequest({ session_id: "s1" }));
    expect(await res.json()).toEqual({ success: true, alerted: false });
    expect(mockCreateServiceClient).not.toHaveBeenCalled();
  });
});
