import { supabase as defaultSupabase } from "@/lib/supabase";
import { mapRentalTenantRowToRentalTenant, mapRentalTenantToRow } from "./rental-tenant.mapper";

export class SupabaseRentalTenantRepository {
  constructor({ supabaseClient = defaultSupabase } = {}) { this.supabase = supabaseClient; }
  require(value, message) { if (typeof value !== "string" || value.trim() === "") throw new Error(message); return value.trim(); }
  async save(tenant, context) {
    const ownerId = this.require(context?.ownerId, "Rental tenant owner id is required.");
    const { data, error } = await this.supabase.from("rental_tenants")
      .upsert(mapRentalTenantToRow(tenant, ownerId), { onConflict: "owner_id,id" }).select("*").single();
    if (error) throw error;
    return mapRentalTenantRowToRentalTenant(data);
  }
  async findById(id, ownerId) {
    const { data, error } = await this.supabase.from("rental_tenants").select("*")
      .eq("owner_id", this.require(ownerId, "Rental tenant owner id is required."))
      .eq("id", this.require(id, "Rental tenant id is required.")).maybeSingle();
    if (error) throw error;
    return data ? mapRentalTenantRowToRentalTenant(data) : null;
  }
  async findByAuthUserId(authUserId) {
    const { data, error } = await this.supabase.from("rental_tenants").select("*")
      .eq("auth_user_id", this.require(authUserId, "Rental tenant auth user id is required.")).maybeSingle();
    if (error) throw error;
    return data ? mapRentalTenantRowToRentalTenant(data) : null;
  }
}
Object.freeze(SupabaseRentalTenantRepository);
