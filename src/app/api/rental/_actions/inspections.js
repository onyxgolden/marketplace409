import { NextResponse } from "next/server";
import { badRequest } from "./shared.js";

export async function saveInspection({ authenticated, body, effectiveOwnerId }) {
  const input = body.inspection;
  const items = body.items;
  if (!input?.leaseId || !input?.unitId || !input?.tenantId || !["move_in", "move_out", "periodic"].includes(input.inspectionType) || !input.inspectionDate)
    return badRequest("Lease, unit, tenant, inspection type, and date are required.");
  if (!Array.isArray(items) || items.length === 0 || items.some((item) => !item.area?.trim() || !item.component?.trim() || !["excellent", "good", "fair", "poor", "damaged", "not_inspected"].includes(item.conditionRating)))
    return badRequest("At least one complete inspection item is required.");
  const [{ data: lease, error: leaseError }, { data: membership, error: membershipError }] = await Promise.all([
    authenticated.supabaseClient.from("rental_leases").select("id, unit_id").eq("owner_id", effectiveOwnerId).eq("id", input.leaseId).maybeSingle(),
    authenticated.supabaseClient.from("rental_lease_tenants").select("tenant_id").eq("owner_id", effectiveOwnerId).eq("lease_id", input.leaseId).eq("tenant_id", input.tenantId).maybeSingle(),
  ]);
  if (leaseError || membershipError) throw leaseError || membershipError;
  if (!lease || lease.unit_id !== input.unitId || !membership) return badRequest("Inspection unit and tenant must belong to the selected lease.");
  const evidenceIds = [...new Set(items.map((item) => item.evidenceDocumentId).filter(Boolean))];
  if (evidenceIds.length) {
    const { data: evidence, error: evidenceError } = await authenticated.supabaseClient.from("rental_documents").select("id").eq("owner_id", effectiveOwnerId).eq("lease_id", input.leaseId).in("id", evidenceIds);
    if (evidenceError) throw evidenceError;
    if ((evidence || []).length !== evidenceIds.length) return badRequest("Inspection evidence must be a saved document for the selected lease.");
  }
  const { data, error } = await authenticated.supabaseClient.rpc("save_rental_inspection", { p_owner_id: effectiveOwnerId, p_inspection: input, p_items: items });
  if (error) throw error;
  return NextResponse.json({ success: true, inspection: data });
}

export async function finalizeInspection({ authenticated, body, effectiveOwnerId, timestamp }) {
  if (typeof body.inspectionId !== "string" || !body.inspectionId.trim()) return badRequest("inspectionId is required.");
  const { data, error } = await authenticated.supabaseClient.from("rental_inspections").update({ status: "finalized", finalized_at: timestamp, updated_at: timestamp })
    .eq("owner_id", effectiveOwnerId).eq("id", body.inspectionId.trim()).eq("status", "draft").select("*").maybeSingle();
  if (error) throw error;
  if (!data) return NextResponse.json({ error: "Draft inspection was not found." }, { status: 404 });
  return NextResponse.json({ success: true, inspection: data });
}
