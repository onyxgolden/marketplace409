import { NextResponse } from "next/server";
import { createRentalUnit } from "@/domains/rental-unit";
import { validateAddressFields } from "@/lib/address/validateAddress";
import { badRequest, id } from "./shared.js";

export async function saveUnit({ authenticated, body, application, effectiveOwnerId, timestamp }) {
  const input = body.unit;
  if (!input || typeof input !== "object") return badRequest("unit is required.");
  if (!input.id) {
    const existing = await application.findUnitsByProperty(input.propertyId, effectiveOwnerId);
    const duplicate = existing.find((item) => item.status !== "inactive" && item.label.trim().toLowerCase() === String(input.label || "").trim().toLowerCase());
    if (duplicate) return NextResponse.json({ error: `${duplicate.label} already exists. Select it to edit the existing property/unit.` }, { status: 409 });
  }
  const addressCheck = validateAddressFields({
    street: input.addressStreet, unit: input.addressUnit, city: input.addressCity,
    state: input.addressState, zip: input.addressZip,
  }, { allowEmptyGroup: Boolean(input.id) });
  if (!addressCheck.ok) return badRequest(Object.values(addressCheck.errors).join(" "));
  const unit = createRentalUnit({ ...input, id: id("rental_unit", input.id), createdAt: input.createdAt || timestamp,
    updatedAt: timestamp, bedrooms: input.bedrooms ?? null, bathrooms: input.bathrooms ?? null,
    squareFeet: input.squareFeet ?? null, availableAt: input.availableAt ?? null, notes: input.notes ?? null,
    addressStreet: addressCheck.values.street || null, addressUnit: addressCheck.values.unit || null,
    addressCity: addressCheck.values.city || null, addressState: addressCheck.values.state || null,
    addressZip: addressCheck.values.zip || null });
  return NextResponse.json({ success: true, unit: await application.saveUnit(unit, effectiveOwnerId) });
}

export async function archiveUnit({ authenticated, body, application, effectiveOwnerId, timestamp }) {
  if (typeof body.unitId !== "string" || body.unitId.trim() === "") return badRequest("unitId is required.");
  const unit = await application.units.findById(body.unitId.trim(), effectiveOwnerId);
  if (!unit) return NextResponse.json({ error: "Property/unit not found." }, { status: 404 });
  const { data: activeLeases, error: leaseError } = await authenticated.supabaseClient.from("rental_leases")
    .select("id").eq("owner_id", effectiveOwnerId).eq("unit_id", unit.id).eq("status", "active").limit(1);
  if (leaseError) throw leaseError;
  if (activeLeases?.length) return NextResponse.json({ error: "End or transfer the active lease before archiving this property/unit." }, { status: 409 });
  const archived = createRentalUnit({ ...unit, status: "inactive", updatedAt: timestamp });
  return NextResponse.json({ success: true, unit: await application.saveUnit(archived, effectiveOwnerId) });
}

export async function deleteArchivedUnit({ authenticated, body, application, effectiveOwnerId }) {
  if (typeof body.unitId !== "string" || body.unitId.trim() === "") return badRequest("unitId is required.");
  const unitId = body.unitId.trim();
  const unit = await application.units.findById(unitId, effectiveOwnerId);
  if (!unit) return NextResponse.json({ error: "Property/unit not found." }, { status: 404 });
  if (unit.status !== "inactive") return NextResponse.json({ error: "Archive the duplicate before permanently deleting it." }, { status: 409 });
  const referenceTables = ["rental_leases", "rental_maintenance_requests", "rental_inspections"];
  const referenceResults = await Promise.all(referenceTables.map((table) => authenticated.supabaseClient.from(table)
    .select("id").eq("owner_id", effectiveOwnerId).eq("unit_id", unitId).limit(1)));
  const referenceError = referenceResults.find((result) => result.error)?.error;
  if (referenceError) throw referenceError;
  if (referenceResults.some((result) => result.data?.length)) return NextResponse.json({
    error: "This archived property/unit has linked lease, maintenance, or inspection history and cannot be permanently deleted.",
  }, { status: 409 });
  const { data, error } = await authenticated.supabaseClient.from("rental_units").delete()
    .eq("owner_id", effectiveOwnerId).eq("id", unitId).eq("status", "inactive").select("id, label").maybeSingle();
  if (error) throw error;
  if (!data) return NextResponse.json({ error: "Archived property/unit was not found." }, { status: 404 });
  return NextResponse.json({ success: true, deletedUnit: data });
}
