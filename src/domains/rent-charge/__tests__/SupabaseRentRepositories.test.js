import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
import { SupabaseRentScheduleRepository } from "../../rent-schedule/SupabaseRentScheduleRepository.js";
import { SupabaseRentChargeRepository } from "../SupabaseRentChargeRepository.js";
const query = { upsert: vi.fn(), select: vi.fn(), eq: vi.fn(), order: vi.fn(), single: vi.fn(), maybeSingle: vi.fn() };
const client = { from: vi.fn(() => query), rpc: vi.fn() };
const scheduleRow = { owner_id: "owner_1", id: "schedule_1", lease_id: "lease_1", status: "active", amount_cents: 125000,
  currency_code: "USD", due_day: 1, effective_start_date: "2026-09-01", effective_end_date: null,
  created_at: "2026-08-12T00:00:00.000Z", updated_at: "2026-08-12T00:00:00.000Z" };
const chargeRow = { owner_id: "owner_1", id: "charge_1", lease_id: "lease_1", schedule_id: "schedule_1", period: "2026-09",
  due_date: "2026-09-01", amount_cents: 125000, paid_amount_cents: 0, currency_code: "USD", status: "due",
  source_key: "rent:schedule_1:2026-09", created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z", voided_at: null, notes: null };
describe("Supabase rent repositories", () => {
  beforeEach(() => { vi.clearAllMocks(); Object.values(query).forEach((method) => method.mockReturnValue(query)); });
  it("upserts owner-scoped schedules", async () => {
    query.single.mockResolvedValue({ data: scheduleRow, error: null });
    const result = await new SupabaseRentScheduleRepository({ supabaseClient: client }).save({ id: "schedule_1", leaseId: "lease_1",
      status: "active", amountCents: 125000, currencyCode: "USD", dueDay: 1, effectiveStartDate: "2026-09-01",
      effectiveEndDate: null, createdAt: scheduleRow.created_at, updatedAt: scheduleRow.updated_at }, { ownerId: "owner_1" });
    expect(query.upsert).toHaveBeenCalledWith(expect.objectContaining({ owner_id: "owner_1" }), { onConflict: "owner_id,id" });
    expect(result.id).toBe("schedule_1");
  });
  it("generates through the atomic RPC", async () => {
    client.rpc.mockResolvedValue({ data: chargeRow, error: null });
    const result = await new SupabaseRentChargeRepository({ supabaseClient: client }).generate("schedule_1", "2026-09", "owner_1");
    expect(client.rpc).toHaveBeenCalledWith("generate_monthly_rent_charge", {
      p_owner_id: "owner_1", p_schedule_id: "schedule_1", p_period: "2026-09" });
    expect(result.sourceKey).toBe("rent:schedule_1:2026-09");
  });
  it("requires owner scope before generation", async () => {
    await expect(new SupabaseRentChargeRepository({ supabaseClient: client }).generate("schedule_1", "2026-09", ""))
      .rejects.toThrow("Rent charge owner id is required.");
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
