// Work Package Planner file import — confirm.
//
// Re-validates the previewed rows against FRESH data (versions and
// matches may have moved since the preview) and applies them through
// the existing create/update services. A plan that no longer validates
// is refused outright; rows that fail at apply time are reported
// per-row and do not stop the rest.
import { NextResponse } from "next/server";
import { workAuth, ok, fail, serverError, readJson } from "../../_lib/auth.js";
import {
  IMPORT_SOURCE_SYSTEMS,
  validateAndPlanWorkPackageImport,
} from "@/domains/work-management/workPackageImport";
import {
  loadImportContext,
  applyWorkPackageImport,
} from "@/application/work-management/workPackageImportApply";
import { MAX_IMPORT_ROWS } from "../preview/route.js";

export async function POST(request) {
  try {
    const auth = await workAuth(request);
    if (auth.error) return auth.error;
    const body = await readJson(request);
    const kind = body?.kind;
    if (kind !== "packages" && kind !== "steps") {
      return NextResponse.json({ error: "kind must be packages or steps." }, { status: 400 });
    }
    const packageId = kind === "steps" ? String(body?.packageId || "") : null;
    if (kind === "steps" && !packageId) {
      return NextResponse.json({ error: "packageId is required to import steps." }, { status: 400 });
    }
    const sourceSystem = body?.sourceSystem ? String(body.sourceSystem) : null;
    if (sourceSystem && !IMPORT_SOURCE_SYSTEMS.includes(sourceSystem)) {
      return NextResponse.json({ error: `sourceSystem must be one of: ${IMPORT_SOURCE_SYSTEMS.join(", ")}.` }, { status: 400 });
    }
    const rows = Array.isArray(body?.rows) ? body.rows : null;
    if (!rows || rows.length === 0) {
      return NextResponse.json({ error: "No rows to import." }, { status: 400 });
    }
    if (rows.length > MAX_IMPORT_ROWS) {
      return NextResponse.json({ error: `This import has ${rows.length} rows — split it into files of ${MAX_IMPORT_ROWS} rows or fewer.` }, { status: 400 });
    }
    const context = await loadImportContext(auth.db, { ownerId: auth.ownerId, kind, packageId });
    if (!context.ok) return fail(context);
    const plan = validateAndPlanWorkPackageImport({
      kind,
      rows,
      existingPackages: context.existingPackages || [],
      existingSteps: context.existingSteps || [],
      sourceSystem,
      sourceTrackingAvailable: context.sourceTrackingAvailable,
      properties: context.properties,
    });
    if (!plan.success) {
      return NextResponse.json({
        error: "This import has errors. Fix the file and preview again.",
        errors: plan.errors,
      }, { status: 400 });
    }
    const results = await applyWorkPackageImport(auth.db, {
      ownerId: auth.ownerId,
      actor: auth.actor,
      kind,
      plan,
      packageId,
      sourceSystem,
      sourceTrackingAvailable: context.sourceTrackingAvailable,
    });
    return ok({
      success: true,
      kind,
      created: results.created,
      updated: results.updated,
      warnings: results.warnings,
      errors: results.errors,
      summary: {
        created: results.created.length,
        updated: results.updated.length,
        warnings: results.warnings.length,
        errors: results.errors.length,
      },
    });
  } catch (error) {
    return serverError("Work package import confirm error", error);
  }
}
