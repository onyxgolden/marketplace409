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

export async function setUnitStatus({ authenticated, body, application, effectiveOwnerId, timestamp }) {
  // Controls-sweep G4 (L-05; Q-09 resolved — no flow ever moved a unit from
  // preparing to available, so a Setup-created unit could never be listed).
  // This is the single transition for the three live statuses. Archiving
  // stays on archive-unit (active-lease guard) and un-archiving on
  // restore-unit; neither is reachable through this op.
  if (typeof body.unitId !== "string" || body.unitId.trim() === "") return badRequest("unitId is required.");
  const nextStatus = body.status;
  if (!["preparing", "available", "occupied"].includes(nextStatus)) return badRequest("status must be preparing, available, or occupied.");
  const unitId = body.unitId.trim();
  const unit = await application.units.findById(unitId, effectiveOwnerId);
  if (!unit) return NextResponse.json({ error: "Property/unit not found." }, { status: 404 });
  if (unit.status === "inactive") return NextResponse.json({ error: "Restore this archived property/unit before changing its status." }, { status: 409 });
  if (unit.status === nextStatus) return NextResponse.json({ success: true, unit });
  const { data: activeLeases, error: leaseError } = await authenticated.supabaseClient.from("rental_leases")
    .select("id").eq("owner_id", effectiveOwnerId).eq("unit_id", unitId).eq("status", "active").limit(1);
  if (leaseError) throw leaseError;
  const hasActiveLease = (activeLeases || []).length > 0;
  if (nextStatus === "occupied" && !hasActiveLease) return NextResponse.json({ error: "Only a unit with an active lease can be marked occupied. Activate the lease first, or leave the unit available." }, { status: 409 });
  if (unit.status === "preparing" && nextStatus === "occupied") return NextResponse.json({ error: "Mark the unit available first, then occupied once its lease is active." }, { status: 409 });
  if (unit.status === "occupied" && hasActiveLease) return NextResponse.json({ error: "End the active lease before changing this unit's status." }, { status: 409 });
  const updated = createRentalUnit({ ...unit, status: nextStatus, updatedAt: timestamp });
  return NextResponse.json({ success: true, unit: await application.saveUnit(updated, effectiveOwnerId) });
}

export async function restoreUnit({ authenticated, body, application, effectiveOwnerId, timestamp }) {
  // Controls-sweep G4 (L-06): un-archive. The pre-archive status is not kept,
  // so a restored unit returns to preparing — it must be reviewed and marked
  // available before it can be listed again. Permanent delete keeps its
  // history guard untouched.
  if (typeof body.unitId !== "string" || body.unitId.trim() === "") return badRequest("unitId is required.");
  const unit = await application.units.findById(body.unitId.trim(), effectiveOwnerId);
  if (!unit) return NextResponse.json({ error: "Property/unit not found." }, { status: 404 });
  if (unit.status !== "inactive") return NextResponse.json({ error: "Only an archived property/unit can be restored." }, { status: 409 });
  const restored = createRentalUnit({ ...unit, status: "preparing", updatedAt: timestamp });
  return NextResponse.json({ success: true, unit: await application.saveUnit(restored, effectiveOwnerId) });
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
