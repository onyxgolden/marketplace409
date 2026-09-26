import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route.js";

const mocks = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("@/infrastructure/notifications/ResendRentalEmailProvider", () => ({
  createResendRentalEmailProvider: () => ({ send: mocks.send }),
}));

let DB;
let upsertCalls;
let updateCalls;
let eventLog;

function chainable(table) {
  const rows = DB[table] ?? [];
  const obj = {
    select: () => obj,
    eq: () => obj,
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    upsert: (row, options) => {
      upsertCalls.push({ table, row, options });
      eventLog.push("billing-enabled");
      return obj;
    },
    update: (patch) => {
      updateCalls.push({ table, patch });
      eventLog.push("invited_at-stamped");
      return obj;
    },
    then: (resolve) => resolve({ data: [], error: null }),
  };
  return obj;
}

vi.mock("@/lib/supabase/createRentalWebhookClient", () => ({
  createRentalWebhookClient: () => ({ from: (table) => chainable(table) }),
}));

const ERIC_TENANT = {
  id: "rental_tenant_a5822588-f661-4346-b6cc-f914aa22ffea",
  display_name: "Eric Carrillo",
  email: "eric.carillo5@yahoo.com",
  status: "invited",
  auth_user_id: null,
  invited_at: "2026-09-01T00:33:55.808Z",
};

function seedDefaultDb() {
  DB = {
    rental_tenants: [{ ...ERIC_TENANT }],
    rental_lease_tenants: [{ lease_id: "rental_lease_9530cad2-7457-4bca-8d7c-974cc5d6c1e3" }],
    rental_leases: [{ unit_id: "unit_paula", start_date: "2026-08-29", monthly_rent_cents: 160000 }],
    rental_units: [{ label: "308 PAULA" }],
  };
}

function authedRequest(path = "/api/rental/cron/tenant-invite") {
  return new Request(`https://example.com${path}`, {
    headers: { authorization: "Bearer test-cron-secret" },
  });
}

beforeEach(() => {
  process.env.CRON_SECRET = "test-cron-secret";
  delete process.env.RENTAL_EMAIL_SENDER;
  process.env.NEXT_PUBLIC_SITE_URL = "https://marketplace409.vercel.app";
  mocks.send.mockReset().mockImplementation(async () => {
    eventLog.push("invite-sent");
    return { id: "resend_msg_1" };
  });
  upsertCalls = [];
  updateCalls = [];
  eventLog = [];
  seedDefaultDb();
});

afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("tenant-invite cron route", () => {
  it("returns 401 without the cron secret", async () => {
    const res = await GET(new Request("https://example.com/api/rental/cron/tenant-invite"));
    expect(res.status).toBe(401);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("dry run plans the send without writing or emailing", async () => {
    const res = await GET(authedRequest("/api/rental/cron/tenant-invite?dryRun=true"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.action).toBe("would_send");
    expect(body.recipient).toBe("eric.carillo5@yahoo.com");
    expect(body.leaseSummary).toEqual({ unitLabel: "308 PAULA", monthlyRentCents: 160000, startDate: "2026-08-29" });
    expect(body.subject).toContain("FORGE");
    expect(mocks.send).not.toHaveBeenCalled();
    expect(upsertCalls).toEqual([]);
    expect(updateCalls).toEqual([]);
  });

  it("live run enables billing, sends the invite, and stamps invited_at", async () => {
    const res = await GET(authedRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, action: "sent", recipient: "eric.carillo5@yahoo.com", billingEnabled: true });

    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].table).toBe("rental_billing_settings");
    expect(upsertCalls[0].row).toMatchObject({ owner_id: "e1b22131-9100-4a79-bbe2-b82d43af922e", billing_enabled: true });
    expect(upsertCalls[0].options).toEqual({ onConflict: "owner_id" });

    expect(mocks.send).toHaveBeenCalledTimes(1);
    const payload = mocks.send.mock.calls[0][0];
    expect(payload.recipient).toBe("eric.carillo5@yahoo.com");
    expect(payload.senderEmail).toBe("rentals@mail.409marketplace.online");
    expect(payload.id).toMatch(/^tenant-invite-rental_tenant_a5822588-f661-4346-b6cc-f914aa22ffea-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}$/);

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].table).toBe("rental_tenants");
    expect(updateCalls[0].patch.invited_at).toBeTruthy();

    // Failure-ordering regression: billing must flip on only after the invite
    // is sent and recorded, so a send failure never leaves billing on.
    expect(eventLog).toEqual(["invite-sent", "invited_at-stamped", "billing-enabled"]);
  });

  it("no-ops when the tenant already claimed portal access (billing still ensured)", async () => {
    DB.rental_tenants[0].auth_user_id = "75f6fe34-0000-4000-8000-000000000000";
    const res = await GET(authedRequest());
    const body = await res.json();
    expect(body.action).toBe("already_claimed");
    expect(mocks.send).not.toHaveBeenCalled();
    expect(upsertCalls).toHaveLength(1);
    expect(updateCalls).toEqual([]);
  });

  it("no-ops when an invite was already recorded after the go-live cutoff", async () => {
    DB.rental_tenants[0].invited_at = "2026-09-26T15:05:00.000Z";
    const res = await GET(authedRequest());
    const body = await res.json();
    expect(body.action).toBe("already_sent");
    expect(mocks.send).not.toHaveBeenCalled();
    expect(updateCalls).toEqual([]);
  });

  it("returns 404 when the tenant record is missing", async () => {
    DB.rental_tenants = [];
    const res = await GET(authedRequest());
    expect(res.status).toBe(404);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("returns 422 when the tenant has no valid email", async () => {
    DB.rental_tenants[0].email = "not-an-email";
    const res = await GET(authedRequest());
    expect(res.status).toBe(422);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(upsertCalls).toEqual([]);
  });
});
