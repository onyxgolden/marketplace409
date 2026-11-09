// Work Package Planner file import — apply side.
//
// Takes a plan from validateAndPlanWorkPackageImport (re-validated on
// fresh data by the confirm route) and applies it row by row through
// the EXISTING create/update services, so numbering and unique IDs
// stay server-assigned exactly as they are for grid edits. A row that
// fails does not stop the rest: every row lands in created / updated /
// errors, and the caller reports the full tally.
//
// Status: a file may carry a status for a package, but status only
// moves through the lifecycle transition — so after a create/update
// the row is transitioned when the file's status differs. A transition
// the lifecycle refuses (or one needing a reason) is a WARNING on that
// row, not a failure of the row itself: the package is still there,
// still as draft.
//
// Source stamping: when the editable-grid migration has been applied
// (sourceTrackingAvailable), created/updated rows are stamped with
// (source_system, source_record_id) so the next import of the same
// file updates them instead of duplicating them. Packages stamp
// through their plain insert/update; steps stamp through the
// forge_work_step_stamp_source RPC — never a direct client write,
// because authenticated has SELECT only on forge_work_steps (slice
// 5 revoked insert/update/delete) and a direct UPDATE is denied in
// production. The stamp is deliberately not a versioned content
// change (no revision row, no version bump), so stamping never
// invalidates an in-flight edit.
import { createWorkPackage, updateWorkPackage, transitionWorkPackage, listPackagePropertyOptions } from "./workPackages.js";
import { createWorkStep, updateWorkStep, listWorkSteps } from "./workSteps.js";

// The source-tracking columns exist only once the editable-grid
// migration has been applied. Probe for them: a missing-column error
// (42703) means "not applied yet" and import falls back to
// number / sequence / title matching; any other error is real.
export async function probeSourceTracking(db, ownerId) {
  const { error } = await db.from("forge_work_packages")
    .select("source_system").eq("owner_id", ownerId).limit(1);
  if (!error) return true;
  if (error.code === "42703"
      || (typeof error.message === "string" && error.message.includes("source_system"))) return false;
  throw error;
}

// Existing packages for import matching. The select lists the source
// columns only when the probe says they exist — selecting them before
// the migration applies would fail every package import (and the list
// page, which is why listWorkPackages itself does not select them).
export async function listPackagesForImport(db, { ownerId }) {
  const tracked = await probeSourceTracking(db, ownerId);
  const columns = tracked
    ? "id, code, title, status, source_system, source_record_id"
    : "id, code, title, status";
  const { data, error } = await db.from("forge_work_packages").select(columns).eq("owner_id", ownerId);
  if (error) throw error;
  return { packages: data || [], sourceTrackingAvailable: tracked };
}

// Existing steps for import matching, paged exhaustively (the service
// caps a page at 200). Retired steps stay in the pool so a re-import
// matches them instead of creating a duplicate active step.
export async function listStepsForImport(db, { ownerId, packageId }) {
  const steps = [];
  let offset = 0;
  for (;;) {
    const page = await listWorkSteps(db, {
      ownerId, packageId, includeRetired: true, limit: 200, offset,
    });
    if (!page.ok) return page;
    steps.push(...page.steps);
    if (page.steps.length < 200) break;
    offset += 200;
  }
  return { ok: true, steps };
}

// Everything the preview/confirm routes need to plan an import:
// existing rows to match against, property options for matching the
// Property column, and whether source tracking is available.
export async function loadImportContext(db, { ownerId, kind, packageId }) {
  if (kind === "packages") {
    const propertyResult = await listPackagePropertyOptions(db, { ownerId });
    const properties = propertyResult.ok ? propertyResult.properties : [];
    const { packages, sourceTrackingAvailable } = await listPackagesForImport(db, { ownerId });
    return { ok: true, existingPackages: packages, sourceTrackingAvailable, properties };
  }
  const tracked = await probeSourceTracking(db, ownerId);
  const stepsResult = await listStepsForImport(db, { ownerId, packageId });
  if (!stepsResult.ok) return stepsResult;
  return { ok: true, existingSteps: stepsResult.steps, sourceTrackingAvailable: tracked, properties: [] };
}

async function stampStepSource(db, { ownerId, packageId, stepId, sourceSystem, sourceRecordId }) {
  const { error } = await db.rpc("forge_work_step_stamp_source", {
    p_owner_id: ownerId,
    p_package_id: packageId,
    p_step_id: stepId,
    p_source_system: sourceSystem,
    p_source_record_id: sourceRecordId,
  });
  if (error) throw error;
}

function sameValue(a, b) {
  return (a ?? null) === (b ?? null);
}

export async function applyWorkPackageImport(db, {
  ownerId, actor, kind, plan, packageId,
  sourceSystem = null, sourceTrackingAvailable = false,
}) {
  const results = { created: [], updated: [], warnings: [], errors: [] };
  const trackSource = sourceTrackingAvailable && sourceSystem;
  const isSteps = kind === "steps";

  for (const item of plan.creates || []) {
    const fields = item.fields || {};
    try {
      if (!isSteps) {
        const input = {
          title: fields.title,
          package_type: fields.packageType ?? "other",
          property_id: fields.propertyId ?? null,
          planned_start: fields.plannedStart ?? null,
          planned_finish: fields.plannedFinish ?? null,
          description: fields.description ?? null,
        };
        if (trackSource && fields.sourceRecordId) {
          input.source_system = sourceSystem;
          input.source_record_id = fields.sourceRecordId;
        }
        const created = await createWorkPackage(db, { ownerId, actor, input });
        if (!created.ok) {
          results.errors.push({ rowIndex: item.rowIndex, message: created.error });
          continue;
        }
        let pkg = created.package;
        if (item.statusTarget && item.statusTarget !== pkg.status) {
          const moved = await transitionWorkPackage(db, {
            ownerId, actor, packageId: pkg.id, to: item.statusTarget,
          });
          if (!moved.ok) {
            results.warnings.push({
              rowIndex: item.rowIndex,
              message: `${pkg.code} was created, but its status could not move to ${item.statusTarget}: ${moved.error}`,
            });
          } else pkg = moved.package;
        }
        results.created.push({ rowIndex: item.rowIndex, package: pkg });
      } else {
        const input = {
          title: fields.title,
          description: fields.description ?? null,
          craftLabel: fields.craftLabel ?? null,
          plannedDurationDays: fields.plannedDurationDays ?? null,
          plannedPersonHours: fields.plannedPersonHours ?? null,
          // The file's step # is a position, not an identity: the RPC
          // assigns the sequence number; insertAt places it in order.
          insertAt: fields.sequenceNo ?? null,
        };
        const created = await createWorkStep(db, { ownerId, packageId, input });
        if (!created.ok) {
          results.errors.push({ rowIndex: item.rowIndex, message: created.error });
          continue;
        }
        const step = created.step;
        if (trackSource && fields.sourceRecordId) {
          try {
            await stampStepSource(db, {
              ownerId, packageId, stepId: step.id, sourceSystem, sourceRecordId: fields.sourceRecordId,
            });
          } catch (e) {
            results.warnings.push({
              rowIndex: item.rowIndex,
              message: `Step #${step.sequenceNo} was created, but its source record could not be saved (${e?.message || "unknown error"}) — importing this file again may duplicate it.`,
            });
          }
        }
        results.created.push({ rowIndex: item.rowIndex, step });
      }
    } catch (e) {
      results.errors.push({ rowIndex: item.rowIndex, message: e?.message || "Could not apply this row." });
    }
  }

  for (const item of plan.updates || []) {
    const fields = item.fields || {};
    const current = item.current || {};
    try {
      if (!isSteps) {
        const patch = {};
        if (fields.title !== undefined && !sameValue(fields.title, current.title)) patch.title = fields.title;
        if (fields.packageType !== undefined && !sameValue(fields.packageType, current.package_type)) patch.package_type = fields.packageType;
        if (fields.propertyId !== undefined && !sameValue(fields.propertyId, current.property_id)) patch.property_id = fields.propertyId;
        if (fields.plannedStart !== undefined && !sameValue(fields.plannedStart, current.planned_start?.slice?.(0, 10))) patch.planned_start = fields.plannedStart;
        if (fields.plannedFinish !== undefined && !sameValue(fields.plannedFinish, current.planned_finish?.slice?.(0, 10))) patch.planned_finish = fields.plannedFinish;
        if (fields.description !== undefined && !sameValue(fields.description, current.description)) patch.description = fields.description;
        if (trackSource && fields.sourceRecordId
            && (current.source_system !== sourceSystem || current.source_record_id !== fields.sourceRecordId)) {
          patch.source_system = sourceSystem;
          patch.source_record_id = fields.sourceRecordId;
        }
        let pkg = current;
        if (Object.keys(patch).length > 0) {
          const updated = await updateWorkPackage(db, { ownerId, actor, packageId: item.id, patch });
          if (!updated.ok) {
            results.errors.push({ rowIndex: item.rowIndex, message: updated.error });
            continue;
          }
          pkg = updated.package;
        }
        if (item.statusTarget && item.statusTarget !== pkg.status) {
          const moved = await transitionWorkPackage(db, {
            ownerId, actor, packageId: item.id, to: item.statusTarget,
          });
          if (!moved.ok) {
            results.warnings.push({
              rowIndex: item.rowIndex,
              message: `${pkg.code} was updated, but its status could not move to ${item.statusTarget}: ${moved.error}`,
            });
          } else pkg = moved.package;
        }
        results.updated.push({ rowIndex: item.rowIndex, package: pkg });
      } else {
        const patch = { expectedVersion: item.version };
        if (fields.title !== undefined && !sameValue(fields.title, current.title)) patch.title = fields.title;
        if (fields.description !== undefined && !sameValue(fields.description, current.description)) patch.description = fields.description;
        if (fields.craftLabel !== undefined && !sameValue(fields.craftLabel, current.craftLabel)) patch.craftLabel = fields.craftLabel;
        if (fields.plannedDurationDays !== undefined && !sameValue(fields.plannedDurationDays, current.plannedDurationDays)) patch.plannedDurationDays = fields.plannedDurationDays;
        if (fields.plannedPersonHours !== undefined && !sameValue(fields.plannedPersonHours, current.plannedPersonHours)) patch.plannedPersonHours = fields.plannedPersonHours;
        let step = current;
        if (Object.keys(patch).length > 1) {
          const updated = await updateWorkStep(db, { ownerId, packageId, stepId: item.id, patch });
          if (!updated.ok) {
            results.errors.push({ rowIndex: item.rowIndex, message: updated.error });
            continue;
          }
          step = updated.step;
        }
        if (trackSource && fields.sourceRecordId
            && (current.sourceSystem !== sourceSystem || current.sourceRecordId !== fields.sourceRecordId)) {
          try {
            await stampStepSource(db, {
              ownerId, packageId, stepId: item.id, sourceSystem, sourceRecordId: fields.sourceRecordId,
            });
            step = { ...step, sourceSystem, sourceRecordId: fields.sourceRecordId };
          } catch (e) {
            results.warnings.push({
              rowIndex: item.rowIndex,
              message: `Step #${step.sequenceNo} was updated, but its source record could not be saved (${e?.message || "unknown error"}) — importing this file again may duplicate it.`,
            });
          }
        }
        results.updated.push({ rowIndex: item.rowIndex, step });
      }
    } catch (e) {
      results.errors.push({ rowIndex: item.rowIndex, message: e?.message || "Could not apply this row." });
    }
  }

  return results;
}
