import { NextResponse } from "next/server";
import { badRequest, readOnlyWriteBlocked } from "./shared.js";

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
  // Controls-sweep follow-up G23 (O-14): the save RPC inserts
  // unconditionally (no upsert, no status check), so passing an existing
  // draft id through it would 23505. Edit is handled owner-side here with
  // the same validations above: header update, item replacement, same id.
  // Drafts are never tenant-visible (tenant select requires finalized /
  // acknowledged), so a partial failure stays re-editable through this
  // same path — no published record is ever half-written.
  if (input.id) {
    if (await readOnlyWriteBlocked(authenticated)) return NextResponse.json({ error: "Read-only members cannot edit inspections." }, { status: 403 });
    const { data: existing, error: existingError } = await authenticated.supabaseClient.from("rental_inspections")
      .select("id, status").eq("owner_id", effectiveOwnerId).eq("id", input.id).maybeSingle();
    if (existingError) throw existingError;
    if (!existing) return NextResponse.json({ error: "Inspection was not found." }, { status: 404 });
    if (existing.status !== "draft")
      return NextResponse.json({ error: "Only a draft inspection can be edited — finalized inspections are terminal." }, { status: 409 });
    const { error: headerError } = await authenticated.supabaseClient.from("rental_inspections").update({
      lease_id: input.leaseId, unit_id: input.unitId, tenant_id: input.tenantId,
      inspection_type: input.inspectionType, inspection_date: input.inspectionDate,
      general_notes: input.generalNotes?.trim() ? input.generalNotes.trim() : null,
      updated_at: new Date().toISOString(),
    }).eq("owner_id", effectiveOwnerId).eq("id", input.id);
    if (headerError) throw headerError;
    const { error: clearError } = await authenticated.supabaseClient.from("rental_inspection_items")
      .delete().eq("owner_id", effectiveOwnerId).eq("inspection_id", input.id);
    if (clearError) throw clearError;
    const { error: itemsError } = await authenticated.supabaseClient.from("rental_inspection_items").insert(items.map((item) => ({
      owner_id: effectiveOwnerId, id: `rental_inspection_item_${crypto.randomUUID()}`, inspection_id: input.id,
      area: item.area.trim(), component: item.component.trim(), condition_rating: item.conditionRating,
      notes: item.notes?.trim() ? item.notes.trim() : null, damage_observed: Boolean(item.damageObserved),
      deposit_review_recommended: Boolean(item.depositReviewRecommended),
      estimated_cost_cents: item.estimatedCostCents ?? null, evidence_document_id: item.evidenceDocumentId || null,
    })));
    if (itemsError) throw itemsError;
    return NextResponse.json({ success: true, inspection: { id: input.id, status: "draft" } });
  }
  const { data, error } = await authenticated.supabaseClient.rpc("save_rental_inspection", { p_owner_id: effectiveOwnerId, p_inspection: input, p_items: items });
  if (error) throw error;
  return NextResponse.json({ success: true, inspection: data });
}

// Controls-sweep follow-up G23 (O-14): delete in any state. Items cascade
// on inspection delete; acknowledgement rows restrict, so they are removed
// first — the acknowledgement is part of the inspection record being deleted.
export async function deleteInspection({ authenticated, body, effectiveOwnerId }) {
  if (await readOnlyWriteBlocked(authenticated)) return NextResponse.json({ error: "Read-only members cannot delete inspections." }, { status: 403 });
  if (typeof body.inspectionId !== "string" || !body.inspectionId.trim()) return badRequest("inspectionId is required.");
  const inspectionId = body.inspectionId.trim();
  const { data: existing, error: existingError } = await authenticated.supabaseClient.from("rental_inspections")
    .select("id").eq("owner_id", effectiveOwnerId).eq("id", inspectionId).maybeSingle();
  if (existingError) throw existingError;
  if (!existing) return NextResponse.json({ error: "Inspection was not found." }, { status: 404 });
  const { error: ackError } = await authenticated.supabaseClient.from("rental_inspection_acknowledgements")
    .delete().eq("owner_id", effectiveOwnerId).eq("inspection_id", inspectionId);
  if (ackError) throw ackError;
  const { error: deleteError } = await authenticated.supabaseClient.from("rental_inspections")
    .delete().eq("owner_id", effectiveOwnerId).eq("id", inspectionId);
  if (deleteError) throw deleteError;
  return NextResponse.json({ success: true });
}

export async function finalizeInspection({ authenticated, body, effectiveOwnerId, timestamp }) {
  if (typeof body.inspectionId !== "string" || !body.inspectionId.trim()) return badRequest("inspectionId is required.");
  const { data, error } = await authenticated.supabaseClient.from("rental_inspections").update({ status: "finalized", finalized_at: timestamp, updated_at: timestamp })
    .eq("owner_id", effectiveOwnerId).eq("id", body.inspectionId.trim()).eq("status", "draft").select("*").maybeSingle();
  if (error) throw error;
  if (!data) return NextResponse.json({ error: "Draft inspection was not found." }, { status: 404 });
  return NextResponse.json({ success: true, inspection: data });
}
