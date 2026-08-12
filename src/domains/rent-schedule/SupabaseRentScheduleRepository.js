import { supabase as defaultSupabase } from "@/lib/supabase";
import { mapRentScheduleRow, mapRentScheduleToRow } from "./rent-schedule.persistence";

export class SupabaseRentScheduleRepository {
  constructor({ supabaseClient = defaultSupabase } = {}) { this.supabase = supabaseClient; }
  require(value, message) { if (typeof value !== "string" || value.trim() === "") throw new Error(message); return value.trim(); }
  async save(schedule, context) {
    const ownerId = this.require(context?.ownerId, "Rent schedule owner id is required.");
    const { data, error } = await this.supabase.from("rent_schedules")
      .upsert(mapRentScheduleToRow(schedule, ownerId), { onConflict: "owner_id,id" }).select("*").single();
    if (error) throw error;
    return mapRentScheduleRow(data);
  }
  async findByLease(leaseId, ownerId) {
    const { data, error } = await this.supabase.from("rent_schedules").select("*")
      .eq("owner_id", this.require(ownerId, "Rent schedule owner id is required."))
      .eq("lease_id", this.require(leaseId, "Rent schedule lease id is required."))
      .order("effective_start_date", { ascending: false });
    if (error) throw error;
    return Object.freeze((data || []).map(mapRentScheduleRow));
  }
}
Object.freeze(SupabaseRentScheduleRepository);
