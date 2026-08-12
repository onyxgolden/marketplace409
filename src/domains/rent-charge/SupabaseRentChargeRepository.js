import { supabase as defaultSupabase } from "@/lib/supabase";
import { mapRentChargeRow, mapRentChargeToRow } from "./rent-charge.persistence";

export class SupabaseRentChargeRepository {
  constructor({ supabaseClient = defaultSupabase } = {}) { this.supabase = supabaseClient; }
  require(value, message) { if (typeof value !== "string" || value.trim() === "") throw new Error(message); return value.trim(); }
  async save(charge, context) {
    const ownerId = this.require(context?.ownerId, "Rent charge owner id is required.");
    const { data, error } = await this.supabase.from("rent_charges")
      .upsert(mapRentChargeToRow(charge, ownerId), { onConflict: "owner_id,source_key", ignoreDuplicates: true })
      .select("*").maybeSingle();
    if (error) throw error;
    return data ? mapRentChargeRow(data) : this.findBySourceKey(charge.sourceKey, ownerId);
  }
  async generate(scheduleId, period, ownerId) {
    const requiredOwnerId = this.require(ownerId, "Rent charge owner id is required.");
    const { data, error } = await this.supabase.rpc("generate_monthly_rent_charge", {
      p_owner_id: requiredOwnerId,
      p_schedule_id: this.require(scheduleId, "Rent charge schedule id is required."),
      p_period: this.require(period, "Rent charge period is required."),
    });
    if (error) throw error;
    return data ? mapRentChargeRow(data) : null;
  }
  async findByLease(leaseId, ownerId) {
    const { data, error } = await this.supabase.from("rent_charges").select("*")
      .eq("owner_id", this.require(ownerId, "Rent charge owner id is required."))
      .eq("lease_id", this.require(leaseId, "Rent charge lease id is required."))
      .order("due_date", { ascending: false });
    if (error) throw error;
    return Object.freeze((data || []).map(mapRentChargeRow));
  }
  async findBySourceKey(sourceKey, ownerId) {
    const { data, error } = await this.supabase.from("rent_charges").select("*")
      .eq("owner_id", this.require(ownerId, "Rent charge owner id is required."))
      .eq("source_key", this.require(sourceKey, "Rent charge source key is required.")).maybeSingle();
    if (error) throw error;
    return data ? mapRentChargeRow(data) : null;
  }
}
Object.freeze(SupabaseRentChargeRepository);
