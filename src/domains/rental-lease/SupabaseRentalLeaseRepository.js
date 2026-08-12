import { supabase as defaultSupabase } from "@/lib/supabase";
import { mapRentalLeaseRowsToRentalLease, mapRentalLeaseToRows } from "./rental-lease.mapper";

const SELECT = "*, rental_lease_tenants(owner_id, lease_id, tenant_id)";
export class SupabaseRentalLeaseRepository {
  constructor({ supabaseClient = defaultSupabase } = {}) { this.supabase = supabaseClient; }
  require(value, message) { if (typeof value !== "string" || value.trim() === "") throw new Error(message); return value.trim(); }
  map(row) { const { rental_lease_tenants: tenants = [], ...lease } = row; return mapRentalLeaseRowsToRentalLease(lease, tenants); }
  async save(lease, context) {
    const ownerId = this.require(context?.ownerId, "Rental lease owner id is required.");
    const rows = mapRentalLeaseToRows(lease, ownerId);
    const { error } = await this.supabase.rpc("save_rental_lease", {
      p_owner_id: ownerId, p_lease: rows.lease, p_tenants: rows.tenants,
    });
    if (error) throw error;
    const saved = await this.findById(lease.id, ownerId);
    if (!saved) throw new Error("Saved rental lease could not be loaded.");
    return saved;
  }
  async findById(id, ownerId) {
    const { data, error } = await this.supabase.from("rental_leases").select(SELECT)
      .eq("owner_id", this.require(ownerId, "Rental lease owner id is required."))
      .eq("id", this.require(id, "Rental lease id is required.")).maybeSingle();
    if (error) throw error;
    return data ? this.map(data) : null;
  }
  async findByUnit(unitId, ownerId) { return this.find("unit_id", unitId, ownerId, "Rental lease unit id is required."); }
  async findByTenant(tenantId, ownerId) {
    const requiredOwnerId = this.require(ownerId, "Rental lease owner id is required.");
    const requiredTenantId = this.require(tenantId, "Rental lease tenant id is required.");
    const { data: memberships, error: membershipError } = await this.supabase.from("rental_lease_tenants")
      .select("lease_id").eq("owner_id", requiredOwnerId).eq("tenant_id", requiredTenantId);
    if (membershipError) throw membershipError;
    const ids = (memberships || []).map(({ lease_id }) => lease_id);
    if (ids.length === 0) return Object.freeze([]);
    const { data, error } = await this.supabase.from("rental_leases").select(SELECT)
      .eq("owner_id", requiredOwnerId).in("id", ids).order("start_date", { ascending: false });
    if (error) throw error;
    return Object.freeze((data || []).map((row) => this.map(row)));
  }
  async find(field, value, ownerId, message) {
    const { data, error } = await this.supabase.from("rental_leases").select(SELECT)
      .eq("owner_id", this.require(ownerId, "Rental lease owner id is required."))
      .eq(field, this.require(value, message)).order("start_date", { ascending: false });
    if (error) throw error;
    return Object.freeze((data || []).map((row) => this.map(row)));
  }
}
Object.freeze(SupabaseRentalLeaseRepository);
