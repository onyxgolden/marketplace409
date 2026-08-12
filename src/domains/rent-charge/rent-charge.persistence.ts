import { createRentCharge } from "./rent-charge.types";
import type { RentCharge, RentChargeStatus } from "./rent-charge.types";
export type RentChargeContext = Readonly<{ ownerId: string }>;
export type RentChargeRow = Readonly<{ owner_id: string; id: string; lease_id: string; schedule_id: string; period: string;
  due_date: string; amount_cents: number; paid_amount_cents: number; currency_code: string; status: RentChargeStatus;
  source_key: string; created_at: string; updated_at: string; voided_at: string | null; notes: string | null }>;
export interface RentChargeRepository { save(value: RentCharge, context: RentChargeContext): Promise<RentCharge>;
  findByLease(leaseId: string, ownerId: string): Promise<readonly RentCharge[]>;
  findBySourceKey(sourceKey: string, ownerId: string): Promise<RentCharge | null>; }
function id(value: string, message: string) { if (typeof value !== "string" || value.trim() === "") throw new Error(message); return value.trim(); }
export function mapRentChargeToRow(value: RentCharge, ownerId: string): RentChargeRow { return Object.freeze({
  owner_id: id(ownerId, "Rent charge owner id is required."), id: value.id, lease_id: value.leaseId, schedule_id: value.scheduleId,
  period: value.period, due_date: value.dueDate, amount_cents: value.amountCents, paid_amount_cents: value.paidAmountCents,
  currency_code: value.currencyCode, status: value.status, source_key: value.sourceKey, created_at: value.createdAt,
  updated_at: value.updatedAt, voided_at: value.voidedAt, notes: value.notes }); }
export function mapRentChargeRow(row: RentChargeRow): RentCharge { return createRentCharge({ id: row.id, leaseId: row.lease_id,
  scheduleId: row.schedule_id, period: row.period, dueDate: row.due_date, amountCents: Number(row.amount_cents),
  paidAmountCents: Number(row.paid_amount_cents), currencyCode: row.currency_code, status: row.status, sourceKey: row.source_key,
  createdAt: row.created_at, updatedAt: row.updated_at, voidedAt: row.voided_at, notes: row.notes }); }
export class InMemoryRentChargeRepository implements RentChargeRepository {
  private readonly values = new Map<string, Readonly<{ ownerId: string; value: RentCharge }>>();
  async save(value: RentCharge, context: RentChargeContext) { const ownerId = id(context?.ownerId, "Rent charge owner id is required.");
    const duplicate = Array.from(this.values.values()).find((stored) => stored.ownerId === ownerId && stored.value.sourceKey === value.sourceKey);
    if (duplicate && duplicate.value.id !== value.id) throw new Error("Rent charge source key already exists for this owner.");
    this.values.set(`${ownerId}:${value.id}`, Object.freeze({ ownerId, value })); return value; }
  async findByLease(leaseId: string, ownerId: string) { const owner = id(ownerId, "Rent charge owner id is required.");
    const lease = id(leaseId, "Rent charge lease id is required."); return Object.freeze(Array.from(this.values.values())
      .filter((stored) => stored.ownerId === owner && stored.value.leaseId === lease).map(({ value }) => value)
      .sort((a, b) => b.dueDate.localeCompare(a.dueDate))); }
  async findBySourceKey(sourceKey: string, ownerId: string) { const owner = id(ownerId, "Rent charge owner id is required.");
    const source = id(sourceKey, "Rent charge source key is required."); return Array.from(this.values.values())
      .find((stored) => stored.ownerId === owner && stored.value.sourceKey === source)?.value ?? null; }
}
