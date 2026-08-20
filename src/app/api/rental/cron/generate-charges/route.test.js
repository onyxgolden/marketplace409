import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/createRentalWebhookClient", () => ({ createRentalWebhookClient: vi.fn() }));

import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { GET } from "./route.js";

function request(headers = {}) { return new Request("https://test/api", { headers }); }

function chain(result) {
  const node = { select: vi.fn(() => node), eq: vi.fn(() => node), upsert: vi.fn(async () => result), then: (resolve) => resolve(result) };
  return node;
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
          created_at: "2020-01-01T00:00:00Z", updated_at: "2020-01-01T00:00:00Z" },
        { owner_id: "owner_2", id: "schedule_2", lease_id: "lease_2", status: "active", amount_cents: 90000,
          currency_code: "USD", due_day: 1, effective_start_date: "2020-01-01", effective_end_date: "2021-01-01",
          created_at: "2020-01-01T00:00:00Z", updated_at: "2020-01-01T00:00:00Z" },
      ], error: null,
    });
    const charges = chain({ error: null });
    const db = { from: vi.fn((table) => (table === "rent_schedules" ? schedules : charges)) };
    createRentalWebhookClient.mockReturnValue(db);

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
        created_at: "2020-01-01T00:00:00Z", updated_at: "2020-01-01T00:00:00Z" }], error: null,
    });
    const charges = chain({ error: null });
    createRentalWebhookClient.mockReturnValue({ from: vi.fn((table) => (table === "rent_schedules" ? schedules : charges)) });

    const response = await GET(request({ authorization: "Bearer cron-secret" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.processed).toBe(0);
    expect(body.failed).toBe(1);
  });
});

function cronRunsTable() {
  return { insert: vi.fn(async () => ({ error: null })), update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })) };
}
const activeSchedule = { owner_id: "owner_1", id: "schedule_1", lease_id: "lease_1", status: "active", amount_cents: 150000,
  currency_code: "USD", due_day: 1, effective_start_date: "2020-01-01", effective_end_date: null,
  created_at: "2020-01-01T00:00:00Z", updated_at: "2020-01-01T00:00:00Z" };

describe("rent charge generation cron audit trail", () => {
  it("records exactly one completed audit row, finalizing the same running row, with mapped counts", async () => {
    const schedules = chain({ data: [activeSchedule], error: null });
    const charges = chain({ error: null });
    const cronRuns = cronRunsTable();
    createRentalWebhookClient.mockReturnValue({ from: vi.fn((table) => {
      if (table === "rent_schedules") return schedules;
      if (table === "rental_cron_runs") return cronRuns;
      return charges;
    }) });

    const response = await GET(request({ authorization: "Bearer cron-secret", "user-agent": "vercel-cron/1.0" }));
    expect(response.status).toBe(200);

    expect(cronRuns.insert).toHaveBeenCalledTimes(1);
    const [insertedRow] = cronRuns.insert.mock.calls[0];
    expect(insertedRow).toMatchObject({
      job_name: "generate-charges", route_path: "/api/rental/cron/generate-charges",
      trigger_source: "vercel_cron", status: "running",
    });
    expect(cronRuns.update).toHaveBeenCalledTimes(1);
    const [patch] = cronRuns.update.mock.calls[0];
    expect(patch).toMatchObject({ status: "succeeded", processed_count: 1, succeeded_count: 1, failed_count: 0 });
    const eqMock = cronRuns.update.mock.results[0].value.eq;
    expect(eqMock).toHaveBeenCalledWith("id", insertedRow.id);
  });

  it("classifies a mixed success/failure run as partially_succeeded", async () => {
    const schedules = chain({ data: [
      activeSchedule,
      { ...activeSchedule, id: "schedule_2", amount_cents: -1 },
    ], error: null });
    const charges = chain({ error: null });
    const cronRuns = cronRunsTable();
    createRentalWebhookClient.mockReturnValue({ from: vi.fn((table) => {
      if (table === "rent_schedules") return schedules;
      if (table === "rental_cron_runs") return cronRuns;
      return charges;
    }) });

    const response = await GET(request({ authorization: "Bearer cron-secret" }));
    expect(response.status).toBe(200);
    const [patch] = cronRuns.update.mock.calls[0];
    expect(patch).toMatchObject({ status: "partially_succeeded", succeeded_count: 1, failed_count: 1 });
  });

  it("records a failed audit row and a sanitized error when the schedules query throws", async () => {
    const schedules = chain({ data: null, error: { message: "db unavailable", code: "500" } });
    const cronRuns = cronRunsTable();
    createRentalWebhookClient.mockReturnValue({ from: vi.fn((table) => (table === "rent_schedules" ? schedules : cronRuns)) });

    const response = await GET(request({ authorization: "Bearer cron-secret" }));
    expect(response.status).toBe(500);
    const [patch] = cronRuns.update.mock.calls[0];
    expect(patch.status).toBe("failed");
    expect(patch.error_message).toContain("db unavailable");
  });

  it("still generates charges correctly, without repeating or corrupting business work, even when the audit write fails", async () => {
    const schedules = chain({ data: [activeSchedule], error: null });
    const charges = chain({ error: null });
    createRentalWebhookClient.mockReturnValue({ from: vi.fn((table) => {
      if (table === "rent_schedules") return schedules;
      if (table === "rental_cron_runs") throw new Error("audit table unavailable");
      return charges;
    }) });

    const response = await GET(request({ authorization: "Bearer cron-secret" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.processed).toBe(1);
    expect(body.failed).toBe(0);
    expect(charges.upsert).toHaveBeenCalledTimes(1);
  });

  it("creates no audit record for an unauthorized request", async () => {
    const callsBefore = createRentalWebhookClient.mock.calls.length;
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(createRentalWebhookClient.mock.calls.length).toBe(callsBefore);
  });
});
