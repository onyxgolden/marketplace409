import { createRentSchedule } from "./rent-schedule.types";
import type { RentSchedule, RentScheduleStatus, RentScheduleCollectionMode, RentScheduleCollectionProvider } from "./rent-schedule.types";
export type RentScheduleContext = Readonly<{ ownerId: string }>;
export type RentScheduleRow = Readonly<{ owner_id: string; id: string; lease_id: string; status: RentScheduleStatus;
  amount_cents: number; currency_code: string; due_day: number; effective_start_date: string;
  effective_end_date: string | null; created_at: string; updated_at: string;
  collection_mode: RentScheduleCollectionMode; collection_provider: RentScheduleCollectionProvider | null;
  forge_cutover_date: string | null }>;
export interface RentScheduleRepository { save(value: RentSchedule, context: RentScheduleContext): Promise<RentSchedule>;
  findByLease(leaseId: string, ownerId: string): Promise<readonly RentSchedule[]>; }
function id(value: string, message: string) { if (typeof value !== "string" || value.trim() === "") throw new Error(message); return value.trim(); }
export function mapRentScheduleToRow(value: RentSchedule, ownerId: string): RentScheduleRow { return Object.freeze({
  owner_id: id(ownerId, "Rent schedule owner id is required."), id: value.id, lease_id: value.leaseId, status: value.status,
  amount_cents: value.amountCents, currency_code: value.currencyCode, due_day: value.dueDay,
  effective_start_date: value.effectiveStartDate, effective_end_date: value.effectiveEndDate,
  created_at: value.createdAt, updated_at: value.updatedAt,
  collection_mode: value.collectionMode, collection_provider: value.collectionProvider,
  forge_cutover_date: value.forgeCutoverDate }); }
export function mapRentScheduleRow(row: RentScheduleRow): RentSchedule { return createRentSchedule({ id: row.id, leaseId: row.lease_id,
  status: row.status, amountCents: Number(row.amount_cents), currencyCode: row.currency_code, dueDay: Number(row.due_day),
  effectiveStartDate: row.effective_start_date, effectiveEndDate: row.effective_end_date,
  createdAt: row.created_at, updatedAt: row.updated_at,
  collectionMode: row.collection_mode ?? "external", collectionProvider: row.collection_provider ?? null,
  forgeCutoverDate: row.forge_cutover_date ?? null }); }
export class InMemoryRentScheduleRepository implements RentScheduleRepository {
  private readonly values = new Map<string, Readonly<{ ownerId: string; value: RentSchedule }>>();
  async save(value: RentSchedule, context: RentScheduleContext) { const ownerId = id(context?.ownerId, "Rent schedule owner id is required.");
    this.values.set(`${ownerId}:${value.id}`, Object.freeze({ ownerId, value })); return value; }
  async findByLease(leaseId: string, ownerId: string) { const owner = id(ownerId, "Rent schedule owner id is required.");
    const lease = id(leaseId, "Rent schedule lease id is required."); return Object.freeze(Array.from(this.values.values())
      .filter((stored) => stored.ownerId === owner && stored.value.leaseId === lease).map(({ value }) => value)); }
}
