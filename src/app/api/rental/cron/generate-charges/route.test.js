import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/createRentalWebhookClient", () => ({ createRentalWebhookClient: vi.fn() }));

import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { GET } from "./route.js";

function request(headers = {}) { return new Request("https://test/api", { headers }); }

function chain(result) {
  const node = { select: vi.fn(() => node), eq: vi.fn(() => node), in: vi.fn(() => node), upsert: vi.fn(async () => result), then: (resolve) => resolve(result) };
  return node;
}

function settingsChain(ownerIds) {
  return chain({ data: ownerIds.map((owner_id) => ({ owner_id })), error: null });
}

function db({ settings, schedules, charges }) {
  return { from: vi.fn((table) => {
    if (table === "rental_billing_settings") return settings;
    if (table === "rent_schedules") return schedules;
    return charges;
  }) };
}

beforeEach(() => { process.env.CRON_SECRET = "cron-secret"; });

describe("rent charge generation cron", () => {
  it("rejects callers without the cron secret", async () => {
    const response = await GET(request());
    expect(response.status).toBe(401);
  });

  it("generates charges only for schedules that are active and currently effective", async () => {
    const schedules = chain({
      data: [
        { owner_id: "owner_1", id: "schedule_1", lease_id: "lease_1", status: "active", amount_cents: 150000,
          currency_code: "USD", due_day: 1, effective_start_date: "2020-01-01", effective_end_date: null,
          created_at: "2020-01-01T00:00:00Z", updated_at: "2020-01-01T00:00:00Z",
          collection_mode: "forge", collection_provider: null, forge_cutover_date: "2020-01-01" },
        { owner_id: "owner_2", id: "schedule_2", lease_id: "lease_2", status: "active", amount_cents: 90000,
          currency_code: "USD", due_day: 1, effective_start_date: "2020-01-01", effective_end_date: "2021-01-01",
          created_at: "2020-01-01T00:00:00Z", updated_at: "2020-01-01T00:00:00Z",
          collection_mode: "forge", collection_provider: null, forge_cutover_date: "2020-01-01" },
      ], error: null,
    });
    const charges = chain({ error: null });
    createRentalWebhookClient.mockReturnValue(db({ settings: settingsChain(["owner_1", "owner_2"]), schedules, charges }));

    const response = await GET(request({ authorization: "Bearer cron-secret" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.scheduleCount).toBe(2);
    expect(body.processed).toBe(1);
    expect(body.failed).toBe(0);
    expect(charges.upsert).toHaveBeenCalledTimes(1);
    expect(charges.upsert).toHaveBeenCalledWith(expect.objectContaining({ owner_id: "owner_1", schedule_id: "schedule_1" }), { onConflict: "owner_id,source_key", ignoreDuplicates: true });
  });

  it("counts a bad schedule row as failed without aborting the run", async () => {
    const schedules = chain({
      data: [{ owner_id: "owner_1", id: "schedule_1", lease_id: "lease_1", status: "active", amount_cents: -1,
        currency_code: "USD", due_day: 1, effective_start_date: "2020-01-01", effective_end_date: null,
        created_at: "2020-01-01T00:00:00Z", updated_at: "2020-01-01T00:00:00Z",
        collection_mode: "forge", collection_provider: null, forge_cutover_date: "2020-01-01" }], error: null,
    });
    const charges = chain({ error: null });
    createRentalWebhookClient.mockReturnValue(db({ settings: settingsChain(["owner_1"]), schedules, charges }));

    const response = await GET(request({ authorization: "Bearer cron-secret" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.processed).toBe(0);
    expect(body.failed).toBe(1);
  });

  // Regression guards for the rental billing cutover containment: most tenants still pay through
  // Rentec even though FORGE has an 'active' (lifecycle) schedule for them — this cron must never
  // generate a charge for one of those, only for schedules the landlord explicitly cut over.
  it("queries only collection_mode='forge' schedules — never generates a charge for a lifecycle-active but collection-external schedule", async () => {
    const schedules = chain({ data: [], error: null });
    const charges = chain({ error: null });
    createRentalWebhookClient.mockReturnValue(db({ settings: settingsChain(["owner_1"]), schedules, charges }));

    await GET(request({ authorization: "Bearer cron-secret" }));
    const eqCalls = schedules.eq.mock.calls;
    expect(eqCalls).toContainEqual(["status", "active"]);
    expect(eqCalls).toContainEqual(["collection_mode", "forge"]);
  });

  it("never generates a charge for a schedule the query filter missed but whose mapped domain object is still not FORGE-collectible (defense in depth)", async () => {
    const schedules = chain({
      data: [{ owner_id: "owner_1", id: "schedule_1", lease_id: "lease_1", status: "active", amount_cents: 150000,
        currency_code: "USD", due_day: 1, effective_start_date: "2020-01-01", effective_end_date: null,
        created_at: "2020-01-01T00:00:00Z", updated_at: "2020-01-01T00:00:00Z",
        collection_mode: "external", collection_provider: "rentec", forge_cutover_date: null }], error: null,
    });
    const charges = chain({ error: null });
    createRentalWebhookClient.mockReturnValue(db({ settings: settingsChain(["owner_1"]), schedules, charges }));

    const response = await GET(request({ authorization: "Bearer cron-secret" }));
    const body = await response.json();
    expect(body.processed).toBe(0);
    expect(charges.upsert).not.toHaveBeenCalled();
  });

  // Master pause regression guards: the owner-level gate must exclude an owner entirely, even when
  // that owner has an individually FORGE-activated, cutover-arrived schedule.
  it("generates zero charges and never queries schedules when no owner has rental billing enabled", async () => {
    const schedules = chain({ data: [], error: null });
    const charges = chain({ error: null });
    const settings = settingsChain([]);
    createRentalWebhookClient.mockReturnValue(db({ settings, schedules, charges }));

    const response = await GET(request({ authorization: "Bearer cron-secret" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.scheduleCount).toBe(0);
    expect(body.processed).toBe(0);
    expect(schedules.select).not.toHaveBeenCalled();
  });

  it("restricts the schedule query to only owners with rental billing enabled, excluding a paused owner's already-FORGE-activated schedule", async () => {
    const schedules = chain({ data: [], error: null });
    const charges = chain({ error: null });
    const settings = settingsChain(["owner_enabled"]);
    createRentalWebhookClient.mockReturnValue(db({ settings, schedules, charges }));

    await GET(request({ authorization: "Bearer cron-secret" }));
    expect(schedules.in).toHaveBeenCalledWith("owner_id", ["owner_enabled"]);
  });
});
