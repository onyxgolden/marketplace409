import { supabase as defaultSupabase } from "@/lib/supabase";
import { mapRentalUnitRowToRentalUnit, mapRentalUnitToRow } from "./rental-unit.mapper";

export class SupabaseRentalUnitRepository {
  constructor({ supabaseClient = defaultSupabase } = {}) { this.supabase = supabaseClient; }
  require(value, message) { if (typeof value !== "string" || value.trim() === "") throw new Error(message); return value.trim(); }
  async save(unit, context) {
    const ownerId = this.require(context?.ownerId, "Rental unit owner id is required.");
    const { data, error } = await this.supabase.from("rental_units")
      .upsert(mapRentalUnitToRow(unit, ownerId), { onConflict: "owner_id,id" }).select("*").single();
    if (error) throw error;
    return mapRentalUnitRowToRentalUnit(data);
  }
  async findById(id, ownerId) {
    const { data, error } = await this.supabase.from("rental_units").select("*")
      .eq("owner_id", this.require(ownerId, "Rental unit owner id is required."))
      .eq("id", this.require(id, "Rental unit id is required.")).maybeSingle();
    if (error) throw error;
    return data ? mapRentalUnitRowToRentalUnit(data) : null;
  }
  async findByProperty(propertyId, ownerId) {
    const { data, error } = await this.supabase.from("rental_units").select("*")
      .eq("owner_id", this.require(ownerId, "Rental unit owner id is required."))
      .eq("property_id", this.require(propertyId, "Rental unit property id is required."))
      .order("label", { ascending: true });
    if (error) throw error;
    return Object.freeze((data || []).map(mapRentalUnitRowToRentalUnit));
  }
}
Object.freeze(SupabaseRentalUnitRepository);
